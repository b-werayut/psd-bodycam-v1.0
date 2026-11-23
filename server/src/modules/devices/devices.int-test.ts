import type { RedisClientType } from 'redis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { DSS_CLIENT, type DssClient } from '../../common/dss/dss-client';
import { deviceStatusCacheKey } from '../../common/redis/cache-key';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { SettingsService } from '../../common/settings/settings.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import {
  bearerFor,
  bootHttpContext,
  createTestUsers,
  dropTestUsers,
  resetDevices,
  type HttpContext,
} from '../../test/int-helpers';
import { DeviceStatusDisplayService } from './device-status-display.service';
import { DeviceSyncService } from './device-sync.service';

const PREFIX = 't8d_';
const PASSWORD = 'Test@12345';

let ctx: HttpContext;
let dss: DssClient;
let viewer: string;
let ids: bigint[];

const clearCache = async () => {
  const redis = ctx.app.get<RedisClientType | null>(REDIS_CLIENT);
  if (redis?.isReady && ids.length) await redis.del(ids.map((id) => deviceStatusCacheKey(id)));
};
const setCacheSeconds = async (value: string) => {
  await ctx.sql`update "Settings" set "SettingValue" = ${value} where "SettingKey" = 'status.display-cache-seconds'`;
  ctx.app.get(SettingsService).invalidate();
};
const list = (query = 'pageSize=100') => ctx.http.get(`/api/devices?${query}`).set('Authorization', viewer);
type Row = { deviceCode: string; platformState: string; platformStatusFetchedAt: string | null };
const byCode = (rows: Row[], code: string) => rows.find((r) => r.deviceCode === code)!;

beforeAll(async () => {
  ctx = await bootHttpContext();
  await resetDevices(ctx.sql);
  await createTestUsers(ctx.sql, [{ username: `${PREFIX}viewer`, role: 'VIEWER' }], await hashPassword(PASSWORD));
  viewer = await bearerFor(ctx.http, `${PREFIX}viewer`, PASSWORD);
  dss = ctx.app.get<DssClient>(DSS_CLIENT);
  await ctx.app.get(DeviceSyncService).syncOnce();
  ids = (await ctx.sql`select "Id" from "Devices" order by "Id"`).map((r) => r.Id as bigint);
});

beforeEach(async () => {
  await clearCache();
  await setCacheSeconds('10');
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await clearCache();
  await setCacheSeconds('10');
  await resetDevices(ctx.sql);
  await dropTestUsers(ctx.sql, [`${PREFIX}%`]);
  await ctx.close();
});

describe('GET /api/devices', () => {
  it('lists cameras by code with the status DSS gives (VIEWER can read)', async () => {
    const r = await list();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ page: 1, pageSize: 100, total: 100 });
    expect(r.body.data[0]).toMatchObject({
      deviceCode: 'SIM-0001',
      vendorDeviceId: 'SIM-0001',
      kind: 1,
      status: 1,
      streamingEnabled: true,
      vendorMissingSince: null,
      platformState: 'online',
      currentTeam: null,
    });
    expect(typeof r.body.data[0].id).toBe('string');
    expect(byCode(r.body.data, 'SIM-0010').platformState).toBe('offline');
    expect(Date.parse(r.body.data[0].platformStatusFetchedAt)).not.toBeNaN();
  });

  it('two requests within the cache window call DSS once (DL45)', async () => {
    const spy = vi.spyOn(dss, 'listDevices');
    await list();
    await list();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('status.display-cache-seconds = 0 ⇒ DSS on every request', async () => {
    await setCacheSeconds('0');
    const spy = vi.spyOn(dss, 'listDevices');
    await list();
    await list();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('DSS down ⇒ status from DeviceState, platformStatusFetchedAt null', async () => {
    vi.spyOn(dss, 'listDevices').mockRejectedValue(new Error('DSS down'));
    await ctx.sql`
      update "DeviceState" set "PlatformState" = 1, "LastObservedAt" = now()
      where "DeviceId" = (select "Id" from "Devices" where "DeviceCode" = 'SIM-0001')`;
    const r = await list();
    expect(r.status).toBe(200);
    expect(byCode(r.body.data, 'SIM-0001')).toMatchObject({ platformState: 'online', platformStatusFetchedAt: null });
    expect(byCode(r.body.data, 'SIM-0002')).toMatchObject({ platformState: 'unknown', platformStatusFetchedAt: null });
  });

  it('filters by computed status, searches by code, pages', async () => {
    const offline = await list('pageSize=100&online=offline');
    expect(offline.body.total).toBe(10);
    expect(offline.body.data.every((d: Row) => d.platformState === 'offline')).toBe(true);
    const search = await list('q=SIM-000');
    expect(search.body.total).toBe(9);
    const page2 = await list('pageSize=20&page=2');
    expect(page2.body.data[0].deviceCode).toBe('SIM-0021');
  });

  it('rejects a bad filter and an anonymous caller', async () => {
    expect((await list('online=maybe')).status).toBe(400);
    expect((await ctx.http.get('/api/devices')).status).toBe(401);
  });
});

describe('DeviceStatusDisplayService fail-open (Redis)', () => {
  const service = (redis: unknown) =>
    new DeviceStatusDisplayService(
      redis as RedisClientType | null,
      dss,
      ctx.app.get(SettingsService),
      ctx.app.get<DrizzleDB>(DRIZZLE),
    );
  const sample = async () =>
    (await ctx.sql`select "Id", "VendorDeviceId" from "Devices" order by "Id" limit 3`).map((r) => ({
      id: r.Id as bigint,
      vendorDeviceId: r.VendorDeviceId as string,
    }));

  it('no Redis ⇒ still asks DSS', async () => {
    const spy = vi.spyOn(dss, 'listDevices');
    const map = await service(null).statuses(await sample());
    expect(spy).toHaveBeenCalledTimes(1);
    expect([...map.values()].map((s) => s.platformState)).toEqual(['online', 'online', 'online']);
  });

  it('Redis throwing on read and write ⇒ still asks DSS, no error', async () => {
    const broken = {
      isReady: true,
      mGet: () => Promise.reject(new Error('READONLY')),
      set: () => Promise.reject(new Error('READONLY')),
    };
    const map = await service(broken).statuses(await sample());
    expect(map.size).toBe(3);
  });
});

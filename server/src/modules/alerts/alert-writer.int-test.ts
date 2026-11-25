import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import {
  bootHttpContext,
  createTestUsers,
  dropTestUsers,
  recordingGateway,
  resetDevices,
  type HttpContext,
} from '../../test/int-helpers';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import { ALERT_TYPE } from './alert-types';
import { AlertWriterService } from './alert-writer.service';

const PREFIX = 't3a_';

let ctx: HttpContext;
let ids: Map<string, bigint>;
let deviceId: bigint;

beforeAll(async () => {
  ctx = await bootHttpContext();
  ids = await createTestUsers(
    ctx.sql,
    [
      { username: `${PREFIX}admin`, role: 'SUPER_ADMIN' },
      { username: `${PREFIX}admin_off`, role: 'SUPER_ADMIN', status: 2 },
      { username: `${PREFIX}viewer`, role: 'VIEWER' },
    ],
    'x',
  );
});

beforeEach(async () => {
  await resetDevices(ctx.sql);
  const [row] = await ctx.sql`
    insert into "Devices" ("DeviceCode", "VendorDeviceId", "Kind") values ('T3A-1', 'T3A-1', 1) returning "Id"`;
  deviceId = row.Id as bigint;
});

afterAll(async () => {
  await resetDevices(ctx.sql);
  await dropTestUsers(ctx.sql, [`${PREFIX}%`]);
  await ctx.close();
});

const writer = () => {
  const recorder = recordingGateway();
  const service = new AlertWriterService(
    ctx.app.get<DrizzleDB>(DRIZZLE),
    recorder.gateway as unknown as RealtimeGateway,
  );
  return { service, emits: recorder.emits };
};

const input = () => ({
  alertType: ALERT_TYPE.DEVICE_VENDOR_MISSING,
  severity: 2 as const,
  deviceId,
  title: 'กล้อง T3A-1 หายจากรายการอุปกรณ์ของ DSS',
  message: 'ทดสอบ',
  dedupeKey: `13:device:${deviceId}`,
});

describe('AlertWriterService', () => {
  it('raise inserts a New alert and pushes alert:new to each active SUPER_ADMIN only', async () => {
    const { service, emits } = writer();
    const alertId = await service.raise(input());
    expect(alertId).not.toBeNull();

    const [row] = await ctx.sql`select * from "Alerts" where "Id" = ${alertId!}`;
    expect(row).toMatchObject({ AlertType: 13, Severity: 2, Status: 1, DeviceId: deviceId, DedupeKey: `13:device:${deviceId}` });

    const rooms = emits.map(([room]) => room);
    expect(rooms).toContain(`user:${ids.get(`${PREFIX}admin`)}`);
    expect(rooms).not.toContain(`user:${ids.get(`${PREFIX}admin_off`)}`);
    expect(rooms).not.toContain(`user:${ids.get(`${PREFIX}viewer`)}`);
    const [, event, payload] = emits.find(([room]) => room === `user:${ids.get(`${PREFIX}admin`)}`)!;
    expect(event).toBe('alert:new');
    expect(payload).toMatchObject({
      alertId: String(alertId),
      alertType: 13,
      severity: 2,
      title: 'กล้อง T3A-1 หายจากรายการอุปกรณ์ของ DSS',
      deviceId: String(deviceId),
    });
  });

  it('a second raise with an open alert of the same key returns null and pushes nothing', async () => {
    const { service, emits } = writer();
    await service.raise(input());
    emits.length = 0;
    expect(await service.raise(input())).toBeNull();
    expect(emits).toEqual([]);
    const [{ n }] = await ctx.sql`select count(*)::int as n from "Alerts" where "DedupeKey" = ${`13:device:${deviceId}`}`;
    expect(n).toBe(1);
  });

  it('resolve closes the open alert; a later raise opens a new one', async () => {
    const { service } = writer();
    const first = await service.raise(input());
    expect(await service.resolve(`13:device:${deviceId}`)).toBe(1);
    const [row] = await ctx.sql`select "Status", "ResolvedAt" from "Alerts" where "Id" = ${first!}`;
    expect(row.Status).toBe(3);
    expect(row.ResolvedAt).toBeInstanceOf(Date);
    expect(await service.resolve(`13:device:${deviceId}`)).toBe(0);
    expect(await service.raise(input())).not.toBeNull();
  });
});

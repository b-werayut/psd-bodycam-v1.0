import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DssClient, VendorInventory } from '../../common/dss/dss-client';
import { DssMockClient } from '../../common/dss/dss-mock.client';
import { RedisLockService } from '../../common/lock/redis-lock.service';
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
import { AlertWriterService } from '../alerts/alert-writer.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import { DeviceSyncService } from './device-sync.service';

const PREFIX = 't3s_';

let ctx: HttpContext;
let adminId: bigint;

/** A DSS client whose device list the test controls (based on the simulator's 100 cameras). */
class ScriptedDss implements DssClient {
  inventory: VendorInventory | Error;
  constructor(base: VendorInventory) {
    this.inventory = base;
  }
  fetchReading(): never {
    throw new Error('not used');
  }
  listDevices(): Promise<VendorInventory> {
    return this.inventory instanceof Error ? Promise.reject(this.inventory) : Promise.resolve(this.inventory);
  }
}

let full: VendorInventory;

const build = (dss: DssClient) => {
  const recorder = recordingGateway();
  const db = ctx.app.get<DrizzleDB>(DRIZZLE);
  const alerts = new AlertWriterService(db, recorder.gateway as unknown as RealtimeGateway);
  const service = new DeviceSyncService(db, dss, ctx.app.get(RedisLockService), alerts);
  return { service, emits: recorder.emits };
};

const deviceRow = async (vendorId: string) =>
  (await ctx.sql`select * from "Devices" where "VendorDeviceId" = ${vendorId}`)[0];

beforeAll(async () => {
  ctx = await bootHttpContext();
  const ids = await createTestUsers(ctx.sql, [{ username: `${PREFIX}admin`, role: 'ADMIN' }], 'x');
  adminId = ids.get(`${PREFIX}admin`)!;
  full = await new DssMockClient(100).listDevices();
});

beforeEach(async () => {
  await resetDevices(ctx.sql);
});

afterAll(async () => {
  await resetDevices(ctx.sql);
  await dropTestUsers(ctx.sql, [`${PREFIX}%`]);
  await ctx.close();
});

describe('DeviceSyncService.syncOnce', () => {
  it('simulator: 100 cameras ⇒ 100 Devices rows with a DeviceState row each; a re-run creates nothing', async () => {
    const { service } = build(new DssMockClient(100));
    const first = await service.syncOnce();
    expect(first).toMatchObject({ created: 100, updated: 0, missing: 0, reappeared: 0, vendorTotal: 100, complete: true });

    const [{ devices, states }] = await ctx.sql`
      select (select count(*)::int from "Devices") as devices, (select count(*)::int from "DeviceState") as states`;
    expect({ devices, states }).toEqual({ devices: 100, states: 100 });
    const sim1 = await deviceRow('SIM-0001');
    expect(sim1).toMatchObject({ DeviceCode: 'SIM-0001', Kind: 1, Status: 1, Model: 'DH-MPT230', VendorMissingSince: null });
    expect(sim1.VendorSeenAt).toBeInstanceOf(Date);

    const second = await service.syncOnce();
    expect(second).toMatchObject({ created: 0, updated: 0, missing: 0 });
  });

  it('a camera gone from a complete list gets VendorMissingSince + one alert 13; it is never deleted', async () => {
    const dss = new ScriptedDss(full);
    const { service, emits } = build(dss);
    await service.syncOnce();

    dss.inventory = { ...full, devices: full.devices.filter((d) => d.vendorDeviceId !== 'SIM-0005') };
    expect(await service.syncOnce()).toMatchObject({ missing: 1, reappeared: 0 });
    const gone = await deviceRow('SIM-0005');
    expect(gone.VendorMissingSince).toBeInstanceOf(Date);
    expect(gone.IsDeleted).toBe(false);

    const alerts = await ctx.sql`select * from "Alerts" where "AlertType" = 13`;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ DeviceId: gone.Id, Status: 1, Severity: 2, DedupeKey: `13:device:${gone.Id}` });
    expect(alerts[0].Title).toContain('SIM-0005');
    expect(emits.filter(([room, event]) => room === `user:${adminId}` && event === 'alert:new')).toHaveLength(1);

    // still gone: same VendorMissingSince, no second alert
    emits.length = 0;
    expect(await service.syncOnce()).toMatchObject({ missing: 0 });
    expect((await deviceRow('SIM-0005')).VendorMissingSince).toEqual(gone.VendorMissingSince);
    expect(await ctx.sql`select 1 from "Alerts" where "AlertType" = 13`).toHaveLength(1);
    expect(emits).toEqual([]);

    // back: cleared and the alert resolved
    dss.inventory = full;
    expect(await service.syncOnce()).toMatchObject({ missing: 0, reappeared: 1 });
    expect((await deviceRow('SIM-0005')).VendorMissingSince).toBeNull();
    const [resolved] = await ctx.sql`select "Status" from "Alerts" where "AlertType" = 13`;
    expect(resolved.Status).toBe(3);
  });

  it('an incomplete (paged) list marks nobody missing and raises no alert', async () => {
    const dss = new ScriptedDss(full);
    const { service, emits } = build(dss);
    await service.syncOnce();

    dss.inventory = { ...full, devices: full.devices.slice(0, 50), complete: false };
    expect(await service.syncOnce()).toMatchObject({ missing: 0, complete: false });
    const [{ n }] = await ctx.sql`select count(*)::int as n from "Devices" where "VendorMissingSince" is not null`;
    expect(n).toBe(0);
    expect(await ctx.sql`select 1 from "Alerts"`).toHaveLength(0);
    expect(emits).toEqual([]);
  });

  it('DSS failing ⇒ the run rejects and nothing changes', async () => {
    const dss = new ScriptedDss(full);
    const { service } = build(dss);
    await service.syncOnce();
    dss.inventory = new Error('DSS down');
    await expect(service.syncOnce()).rejects.toThrow('DSS down');
    const [{ n }] = await ctx.sql`select count(*)::int as n from "Devices" where "VendorMissingSince" is not null`;
    expect(n).toBe(0);
  });

  it('two runs at once: the second gets no lock and returns null', async () => {
    const { service } = build(new DssMockClient(100));
    const [a, b] = await Promise.all([service.syncOnce(), service.syncOnce()]);
    expect([a, b].filter((r) => r === null)).toHaveLength(1);
  });
});

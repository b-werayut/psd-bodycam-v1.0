import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DssClient, VendorDeviceReading, VendorInventory } from '../../common/dss/dss-client';
import { DssMockClient } from '../../common/dss/dss-mock.client';
import { RedisLockService } from '../../common/lock/redis-lock.service';
import { SettingsService } from '../../common/settings/settings.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { bootHttpContext, recordingGateway, resetDevices, type HttpContext } from '../../test/int-helpers';
import { AlertWriterService } from '../alerts/alert-writer.service';
import { DeviceStatusService } from '../device-status/device-status.service';
import { DeviceSyncService } from '../devices/device-sync.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import { GpsIngestService } from './gps-ingest.service';
import { GpsPollService } from './gps-poll.service';

let ctx: HttpContext;

/** The simulator with per-camera overrides and a call log. */
class ScriptedDss implements DssClient {
  readonly calls: string[] = [];
  delayMs = 0;
  readonly overrides = new Map<string, () => Promise<VendorDeviceReading>>();
  constructor(private readonly inner = new DssMockClient(100)) {}
  listDevices(): Promise<VendorInventory> {
    return this.inner.listDevices();
  }
  async fetchReading(id: string): Promise<VendorDeviceReading> {
    this.calls.push(id);
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const override = this.overrides.get(id);
    return override ? override() : this.inner.fetchReading(id);
  }
}

const build = (dss: DssClient, lock?: RedisLockService) => {
  const db = ctx.app.get<DrizzleDB>(DRIZZLE);
  const recorder = recordingGateway();
  const gateway = recorder.gateway as unknown as RealtimeGateway;
  const settings = ctx.app.get(SettingsService);
  const realLock = ctx.app.get(RedisLockService);
  const sync = new DeviceSyncService(db, dss, realLock, new AlertWriterService(db, gateway));
  const poll = new GpsPollService(
    db,
    dss,
    new DeviceStatusService(db),
    new GpsIngestService(db, settings, gateway),
    lock ?? realLock,
    settings,
  );
  return { sync, poll };
};

const stateByCode = async (code: string) =>
  (
    await ctx.sql`select s.* from "DeviceState" s join "Devices" d on d."Id" = s."DeviceId" where d."DeviceCode" = ${code}`
  )[0];

beforeAll(async () => {
  ctx = await bootHttpContext();
});

beforeEach(async () => {
  await resetDevices(ctx.sql);
});

afterAll(async () => {
  await resetDevices(ctx.sql);
  await ctx.close();
});

describe('GpsPollService.tick (simulator, 100 cameras)', () => {
  it('asks every camera once, writes state for all and GPS for those with a fix', async () => {
    const dss = new ScriptedDss();
    const { sync, poll } = build(dss);
    await sync.syncOnce();
    const result = await poll.tick();

    // 10 offline (every 10th), 13 online indoors (every other 7th), 77 with a fix
    expect(result).toMatchObject({ devices: 100, observed: 100, fixes: 77, failed: 0 });
    expect(new Set(dss.calls).size).toBe(100);
    expect(dss.calls).toHaveLength(100);

    const [{ observed, points, devices }] = await ctx.sql`
      select (select count(*)::int from "DeviceState" where "LastObservedAt" is not null) as observed,
             (select count(distinct "DeviceId")::int from "GpsLocations") as devices,
             (select count(*)::int from "GpsLocations") as points`;
    expect({ observed, devices, points }).toEqual({ observed: 100, devices: 77, points: 77 });
    expect((await stateByCode('SIM-0010')).PlatformState).toBe(2);
    expect((await stateByCode('SIM-0007')).PlatformState).toBe(1);
    expect((await stateByCode('SIM-0001')).LastFixAt).toBeInstanceOf(Date);
  });

  it('one camera failing (throw) does not stop the others (Review Focus 2)', async () => {
    const dss = new ScriptedDss();
    dss.overrides.set('SIM-0003', () => Promise.reject(new Error('DSS ตอบ 500: boom')));
    const { sync, poll } = build(dss);
    await sync.syncOnce();
    expect(await poll.tick()).toMatchObject({ devices: 100, failed: 1, observed: 99 });
    expect((await stateByCode('SIM-0003')).LastObservedAt).toBeNull();
    expect((await stateByCode('SIM-0004')).LastObservedAt).toBeInstanceOf(Date);
  });

  it('an unknown answer (code 4000 / bad body ⇒ online null, no location) writes no state and no point', async () => {
    const dss = new ScriptedDss();
    dss.overrides.set('SIM-0002', () => Promise.resolve({ vendorDeviceId: 'SIM-0002', online: null, location: null }));
    const { sync, poll } = build(dss);
    await sync.syncOnce();
    await poll.tick();
    const state = await stateByCode('SIM-0002');
    expect(state.LastObservedAt).toBeNull();
    expect(state.PlatformState).toBeNull();
    expect(
      await ctx.sql`select 1 from "GpsLocations" g join "Devices" d on d."Id" = g."DeviceId" where d."DeviceCode" = 'SIM-0002'`,
    ).toHaveLength(0);
  });

  it('a fresh fix without a status counts as online', async () => {
    const dss = new ScriptedDss();
    dss.overrides.set('SIM-0001', () =>
      Promise.resolve({
        vendorDeviceId: 'SIM-0001',
        online: null,
        location: { lat: 13.75, lng: 100.5, recordedAt: new Date(), speedKph: null },
      }),
    );
    const { sync, poll } = build(dss);
    await sync.syncOnce();
    await poll.tick();
    expect((await stateByCode('SIM-0001')).PlatformState).toBe(1);
  });

  it('two ticks at once: the second gets no lock (null); each camera is asked once (Review Focus 1)', async () => {
    const dss = new ScriptedDss();
    dss.delayMs = 5;
    const { sync, poll } = build(dss);
    await sync.syncOnce();
    const results = await Promise.all([poll.tick(), poll.tick()]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(dss.calls).toHaveLength(100);
  });

  it('without Redis the tick does nothing and never calls DSS', async () => {
    const dss = new ScriptedDss();
    const { sync } = build(dss);
    await sync.syncOnce();
    const { poll } = build(dss, new RedisLockService(null));
    expect(await poll.tick()).toBeNull();
    expect(dss.calls).toHaveLength(0);
  });
});

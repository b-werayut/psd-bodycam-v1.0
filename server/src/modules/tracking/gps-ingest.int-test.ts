import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SettingsService } from '../../common/settings/settings.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { bootHttpContext, recordingGateway, resetDevices, type HttpContext } from '../../test/int-helpers';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import { GpsIngestService, type GpsFix } from './gps-ingest.service';

let ctx: HttpContext;
let dev: bigint;
let other: bigint;

type Place = { lat: number; lng: number };
const A: Place = { lat: 13.75, lng: 100.5 };
const B: Place = { lat: 13.77, lng: 100.52 };
const shift = (place: Place, northM: number, eastM = 0): Place => ({
  lat: place.lat + northM / 110_540,
  lng: place.lng + eastM / (111_320 * Math.cos((place.lat * Math.PI) / 180)),
});
/** a time `seconds` from "now - 10 minutes" (inside the future filter, fresh enough to read) */
const base = () => Date.now() - 10 * 60_000;
const fix = (deviceId: bigint, place: Place, at: Date | null, extra: Partial<GpsFix> = {}): GpsFix => ({
  deviceId,
  recordedAt: at,
  ...place,
  speedKph: null,
  ...extra,
});

const build = () => {
  const recorder = recordingGateway();
  const service = new GpsIngestService(
    ctx.app.get<DrizzleDB>(DRIZZLE),
    ctx.app.get(SettingsService),
    recorder.gateway as unknown as RealtimeGateway,
  );
  return { service, emits: recorder.emits };
};
const stateOf = async (id: bigint) => (await ctx.sql`select * from "DeviceState" where "DeviceId" = ${id}`)[0];
const pointsOf = (id: bigint) =>
  ctx.sql`select "RecordedAt", "Lat", "Lng", "IsValidFix" from "GpsLocations" where "DeviceId" = ${id} order by "RecordedAt"`;

const addDevice = async (code: string) => {
  const [row] = await ctx.sql`
    insert into "Devices" ("DeviceCode", "VendorDeviceId", "Kind") values (${code}, ${code}, 1) returning "Id"`;
  await ctx.sql`insert into "DeviceState" ("DeviceId") values (${row.Id})`;
  return row.Id as bigint;
};

beforeAll(async () => {
  ctx = await bootHttpContext();
});

beforeEach(async () => {
  await resetDevices(ctx.sql);
  await ctx.sql`delete from "Depots" where "Code" like 'T5_%'`;
  dev = await addDevice('T5-A');
  other = await addDevice('T5-B');
});

afterAll(async () => {
  await resetDevices(ctx.sql);
  await ctx.sql`delete from "Depots" where "Code" like 'T5_%'`;
  await ctx.close();
});

describe('GpsIngestService.ingest', () => {
  it('an empty batch does nothing', async () => {
    const { service, emits } = build();
    expect(await service.ingest([])).toMatchObject({ received: 0, stored: 0 });
    expect(emits).toEqual([]);
  });

  it('stores fixes, advances the DeviceState snapshot and pushes gps:batch to the tracking room', async () => {
    const t = base();
    const { service, emits } = build();
    const result = await service.ingest([
      fix(dev, A, new Date(t), { speedKph: 12, heading: 90 }),
      fix(dev, shift(A, 100), new Date(t + 30_000)),
      fix(other, B, new Date(t)),
    ]);
    expect(result).toMatchObject({ received: 3, stored: 3, duplicate: 0, stale: 0, future: 0, suspect: 0 });

    expect(await pointsOf(dev)).toHaveLength(2);
    const state = await stateOf(dev);
    expect(state.LastFixAt.getTime()).toBe(t + 30_000);
    expect(state.LastLat).toBeCloseTo(shift(A, 100).lat, 9);
    expect(state.LastFixValid).toBe(true);

    expect(emits).toHaveLength(1);
    const [room, event, payload] = emits[0] as [string, string, { points: Record<string, unknown>[] }];
    expect([room, event]).toEqual(['tracking', 'gps:batch']);
    expect(payload.points).toHaveLength(3);
    expect(payload.points[0]).toMatchObject({
      deviceId: String(dev),
      lat: A.lat,
      lng: A.lng,
      speedKph: 12,
      heading: 90,
      recordedAt: new Date(t).toISOString(),
      isValidFix: true,
    });
  });

  it('the same batch twice: nothing new is stored (Review Focus 4)', async () => {
    const t = base();
    const batch = [fix(dev, A, new Date(t)), fix(dev, shift(A, 50), new Date(t + 15_000))];
    const { service } = build();
    await service.ingest(batch);
    const again = await service.ingest(batch);
    expect(again).toMatchObject({ received: 2, stored: 0, stale: 2 });
    expect(await pointsOf(dev)).toHaveLength(2);
  });

  it('a point more than 2 minutes in the future is dropped; 1 minute ahead is kept', async () => {
    const now = Date.now();
    const { service } = build();
    const result = await service.ingest([
      fix(dev, A, new Date(now + 3 * 60_000)),
      fix(other, B, new Date(now + 60_000)),
    ]);
    expect(result).toMatchObject({ future: 1, stored: 1 });
    expect(await pointsOf(dev)).toHaveLength(0);
    expect(await pointsOf(other)).toHaveLength(1);
  });

  it('a point at or before the last fix is stale and dropped', async () => {
    const t = base();
    const { service } = build();
    await service.ingest([fix(dev, A, new Date(t))]);
    expect(await service.ingest([fix(dev, B, new Date(t - 60_000)), fix(dev, B, new Date(t))])).toMatchObject({
      stale: 2,
      stored: 0,
    });
    expect((await stateOf(dev)).LastLat).toBe(A.lat);
  });

  it('no device time ⇒ stored at now', async () => {
    const before = Date.now();
    const { service } = build();
    await service.ingest([fix(dev, A, null)]);
    const [point] = await pointsOf(dev);
    expect(point.RecordedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(point.RecordedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('an impossible jump (> 200 km/h) is kept as IsValidFix = false, not pushed, snapshot stays', async () => {
    const t = base();
    const { service, emits } = build();
    await service.ingest([fix(dev, A, new Date(t))]);
    emits.length = 0;
    const result = await service.ingest([fix(dev, shift(A, 10_000), new Date(t + 10_000))]);
    expect(result).toMatchObject({ stored: 1, suspect: 1 });
    expect((await pointsOf(dev)).map((p) => p.IsValidFix)).toEqual([true, false]);
    expect((await stateOf(dev)).LastLat).toBe(A.lat);
    expect(emits).toEqual([]);
  });

  it('stale-start: the suspect first point after a cold start is revalidated once the next point confirms it', async () => {
    const t0 = base();
    const OLD = shift(A, -5000, -3000);
    const NEAR_A = shift(A, 230, 160);
    const { service } = build();
    await service.ingest([fix(dev, B, new Date(t0 - 7 * 86_400_000))]);
    await service.ingest([fix(dev, OLD, new Date(t0))]);
    expect(await service.ingest([fix(dev, A, new Date(t0 + 55_000))])).toMatchObject({ suspect: 1 });

    const result = await service.ingest([fix(dev, NEAR_A, new Date(t0 + 99_000))]);
    expect(result).toMatchObject({ revalidated: 1, suspect: 0, stored: 1 });
    expect((await pointsOf(dev)).map((p) => p.IsValidFix)).toEqual([true, true, true, true]);
    expect((await stateOf(dev)).LastLat).toBeCloseTo(NEAR_A.lat, 9);
  });

  it('IsAtDepot: inside an active depot radius ⇒ true; elsewhere ⇒ false', async () => {
    await ctx.sql`insert into "Depots" ("Code", "Name", "Lat", "Lng", "RadiusM") values ('T5_DEPOT', 'ฐาน', ${A.lat}, ${A.lng}, 150)`;
    const t = Date.now() - 30_000;
    const { service } = build();
    await service.ingest([fix(dev, shift(A, 50), new Date(t)), fix(other, B, new Date(t))]);
    expect((await stateOf(dev)).IsAtDepot).toBe(true);
    expect((await stateOf(other)).IsAtDepot).toBe(false);
  });

  it('freshDeviceIds lists only cameras whose newest valid fix is within 150 s', async () => {
    const { service } = build();
    const result = await service.ingest([
      fix(dev, A, new Date(Date.now() - 20_000)),
      fix(other, B, new Date(Date.now() - 10 * 60_000)),
    ]);
    expect(result.freshDeviceIds).toEqual([dev]);
  });
});

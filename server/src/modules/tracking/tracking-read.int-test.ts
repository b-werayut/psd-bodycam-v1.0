import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { SettingsService } from '../../common/settings/settings.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import {
  bearerFor,
  bootHttpContext,
  createTestUsers,
  dropTestUsers,
  eventually,
  recordingGateway,
  resetDevices,
  type HttpContext,
} from '../../test/int-helpers';
import { DeviceSyncService } from '../devices/device-sync.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import { GpsIngestService } from './gps-ingest.service';
import { TrackingReadService } from './tracking-read.service';

const PREFIX = 't9r_';
const PASSWORD = 'Test@12345';

let ctx: HttpContext;
let viewer: string;
let noPerm: string;
let sim1: string;
let t0: number;

const shiftNorth = (lat: number, meters: number) => lat + meters / 110_540;

beforeAll(async () => {
  ctx = await bootHttpContext();
  await resetDevices(ctx.sql);
  await ctx.sql`insert into "Roles" ("Code", "Name") values ('T9_NOPERM', 'ไม่มีสิทธิ์') on conflict ("Code") do nothing`;
  await createTestUsers(
    ctx.sql,
    [
      { username: `${PREFIX}viewer`, role: 'VIEWER' },
      { username: `${PREFIX}noperm`, role: 'T9_NOPERM' },
    ],
    await hashPassword(PASSWORD),
  );
  viewer = await bearerFor(ctx.http, `${PREFIX}viewer`, PASSWORD);
  noPerm = await bearerFor(ctx.http, `${PREFIX}noperm`, PASSWORD);

  await ctx.app.get(DeviceSyncService).syncOnce();
  const [row] = await ctx.sql`select "Id" from "Devices" where "DeviceCode" = 'SIM-0001'`;
  sim1 = String(row.Id);

  // 2 hours ago: 10 min still at A, 10 min walk north, then one impossible jump (suspect)
  t0 = Date.now() - 2 * 3_600_000;
  const ingest = new GpsIngestService(
    ctx.app.get<DrizzleDB>(DRIZZLE),
    ctx.app.get(SettingsService),
    recordingGateway().gateway as unknown as RealtimeGateway,
  );
  const fixes: { at: number; lat: number }[] = [];
  for (let s = 0; s <= 600; s += 30) fixes.push({ at: s, lat: 13.75 });
  for (let s = 630; s <= 1200; s += 30) fixes.push({ at: s, lat: shiftNorth(13.75, (s - 600) * 1.4) });
  await ingest.ingest(
    fixes.map((f) => ({ deviceId: BigInt(sim1), recordedAt: new Date(t0 + f.at * 1000), lat: f.lat, lng: 100.5, speedKph: null })),
  );
  await ingest.ingest([
    { deviceId: BigInt(sim1), recordedAt: new Date(t0 + 1230_000), lat: 14.5, lng: 100.5, speedKph: null },
  ]);
  // a retired camera never shows on the live map
  await ctx.sql`update "Devices" set "Status" = 4 where "DeviceCode" = 'SIM-0100'`;
});

afterAll(async () => {
  await resetDevices(ctx.sql);
  await dropTestUsers(ctx.sql, [`${PREFIX}%`]);
  await ctx.sql`delete from "Roles" where "Code" = 'T9_NOPERM'`;
  await ctx.close();
});

describe('GET /api/tracking/positions', () => {
  it('every live camera with its last fix and screen status (tracking:view)', async () => {
    const r = await ctx.http.get('/api/tracking/positions').set('Authorization', viewer);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(99);
    expect(r.body.fixActiveSeconds).toBe(150);
    const one = r.body.data.find((d: { deviceId: string }) => d.deviceId === sim1);
    expect(one).toMatchObject({ deviceCode: 'SIM-0001', fixValid: true, platformState: 'online' });
    expect(one.lat).toBeCloseTo(shiftNorth(13.75, 600 * 1.4), 9);
    expect(Date.parse(one.lastFixAt)).toBe(t0 + 1200_000);
    const noFix = r.body.data.find((d: { deviceCode: string }) => d.deviceCode === 'SIM-0002');
    expect(noFix).toMatchObject({ lat: null, lng: null, lastFixAt: null });
    expect(r.body.data.some((d: { deviceCode: string }) => d.deviceCode === 'SIM-0100')).toBe(false);
  });

  it('needs tracking:view', async () => {
    expect((await ctx.http.get('/api/tracking/positions').set('Authorization', noPerm)).status).toBe(403);
    expect((await ctx.http.get('/api/tracking/positions')).status).toBe(401);
  });
});

describe('GET /api/tracking/devices/:id/history', () => {
  const history = (id: string, from: string, to: string, auth = viewer) =>
    ctx.http
      .get(`/api/tracking/devices/${id}/history`)
      .query({ from, to })
      .set('Authorization', auth)
      .set('X-Correlation-Id', `t9r-${Date.parse(from)}`);
  const iso = (ms: number) => new Date(ms).toISOString();

  it('builds the route from valid points only and audits the view', async () => {
    const from = iso(t0 - 60_000);
    const r = await history(sim1, from, iso(t0 + 3_600_000));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      device: { id: sim1, code: 'SIM-0001' },
      pointCount: 41,
      suspectCount: 1,
      truncated: false,
      rules: { stopRadiusM: 50, stopMinMinutes: 5, gapSeconds: 150 },
    });
    expect(r.body.start).toMatchObject({ lat: 13.75, at: iso(t0) });
    expect(r.body.segments.length).toBeGreaterThan(0);
    expect(r.body.timeline[0]).toMatchObject({ kind: 'stop', index: 1 });

    const row = await eventually(async () => {
      const [found] = await ctx.sql`select "Action", "ResourceType", "ResourceId" from "AuditLogs"
                                    where "CorrelationId" = ${`t9r-${Date.parse(from)}`}`;
      return found;
    });
    expect(row).toMatchObject({ Action: 'VIEW_GPS_HISTORY', ResourceType: 'Devices', ResourceId: BigInt(sim1) });
  });

  it('INVALID_RANGE for a bad range; 404 for an unknown camera; 403 without tracking:history', async () => {
    const bad = await history(sim1, iso(t0), iso(t0 + 25 * 3_600_000));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_RANGE');
    expect((await history(sim1, 'not-a-date', iso(t0))).body.code).toBe('INVALID_RANGE');
    expect((await history('999999999', iso(t0), iso(t0 + 3_600_000))).status).toBe(404);
    expect((await history(sim1, iso(t0), iso(t0 + 3_600_000), noPerm)).status).toBe(403);
  });

  it('caps the points read and says so (truncated)', async () => {
    const service = ctx.app.get(TrackingReadService);
    const capped = await service.deviceHistory(BigInt(sim1), new Date(t0), new Date(t0 + 3_600_000), 3);
    expect(capped.truncated).toBe(true);
    expect(capped.pointCount).toBe(3);
  });
});

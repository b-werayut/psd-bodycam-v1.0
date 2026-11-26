import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { bearerFor, bootHttpContext, createTestUsers, dropTestUsers, eventually, type HttpContext } from '../../test/int-helpers';
import { RecordingProvider } from './recording-provider';
import { earliestRecordingFrom } from './recording-range';

const PREFIX = 't_recs_';
const CODE = 'TEST-REC-CAM';
const PASSWORD = 'Test@12345';
const DAY_MS = 86_400_000;
const BANGKOK_OFFSET_MS = 7 * 3_600_000;
let ctx: HttpContext;
let operator: string;
let viewer: string;
let leader: string;
let deviceId: string;
let provider: RecordingProvider;

const bangkokDayStart = (at: Date) => new Date(Math.floor((at.getTime() + BANGKOK_OFFSET_MS) / DAY_MS) * DAY_MS - BANGKOK_OFFSET_MS);
const search = (query: Record<string, string>, auth = operator) => ctx.http.get('/api/streams/recordings').set('Authorization', auth).query(query);

beforeAll(async () => {
  ctx = await bootHttpContext();
  await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
  const [row] = await ctx.sql`insert into "Devices" ("DeviceCode", "VendorDeviceId", "Name", "Kind") values (${CODE}, 'vendor-test-rec', 'Test rec camera', 1) returning "Id"`;
  deviceId = String(row.Id);
  await createTestUsers(ctx.sql, [
    { username: `${PREFIX}operator`, role: 'OPERATOR' },
    { username: `${PREFIX}viewer`, role: 'VIEWER' },
    { username: `${PREFIX}leader`, role: 'TEAM_LEADER' },
  ], await hashPassword(PASSWORD));
  operator = await bearerFor(ctx.http, `${PREFIX}operator`, PASSWORD);
  viewer = await bearerFor(ctx.http, `${PREFIX}viewer`, PASSWORD);
  leader = await bearerFor(ctx.http, `${PREFIX}leader`, PASSWORD);
  provider = ctx.app.get(RecordingProvider);
});

beforeEach(async () => {
  await ctx.sql`update "Devices" set "IsDeleted" = false, "Status" = 1 where "DeviceCode" = ${CODE}`;
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  if (ctx) {
    await ctx.sql`delete from "AuditLogs" where "ActorUsername" like ${`${PREFIX}%`}`;
    await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
    await dropTestUsers(ctx.sql, [`${PREFIX}%`]);
    await ctx.close();
  }
});

describe('GET /api/streams/recordings', () => {
  it('lists the two mock files of a day in order, without a work order', async () => {
    const from = new Date(bangkokDayStart(new Date()).getTime() - DAY_MS);
    const to = new Date(from.getTime() + DAY_MS);
    const res = await search({ deviceId, from: from.toISOString(), to: to.toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.from).toBe(from.toISOString());
    expect(res.body.to).toBe(to.toISOString());
    expect(res.body.data).toEqual([
      { startAt: new Date(from.getTime() + 8 * 3_600_000).toISOString(), endAt: new Date(from.getTime() + 10 * 3_600_000).toISOString(), durationSeconds: 7200, workOrder: null },
      { startAt: new Date(from.getTime() + 13 * 3_600_000).toISOString(), endAt: new Date(from.getTime() + 13.75 * 3_600_000).toISOString(), durationSeconds: 2700, workOrder: null },
    ]);
  });

  it('lists a file that ends right before now in a window that ends now', async () => {
    const now = new Date();
    const from = bangkokDayStart(now);
    const file = { startAt: new Date(now.getTime() - 600_000), endAt: new Date(now.getTime() - 10_000), durationSeconds: 590 };
    vi.spyOn(provider, 'search').mockResolvedValue([file]);
    const res = await search({ deviceId, from: from.toISOString(), to: now.toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].endAt).toBe(file.endAt.toISOString());
  });

  it('refuses VIEWER and TEAM_LEADER and requires a token', async () => {
    const q = { deviceId, from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date().toISOString() };
    expect((await ctx.http.get('/api/streams/recordings').query(q)).status).toBe(401);
    expect((await search(q, viewer)).status).toBe(403);
    expect((await search(q, leader)).status).toBe(403);
  });

  it('404 DEVICE_NOT_FOUND for unknown or deleted devices, 200 for retired', async () => {
    const q = { from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date().toISOString() };
    const unknown = await search({ ...q, deviceId: '999999999' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('DEVICE_NOT_FOUND');
    await ctx.sql`update "Devices" set "IsDeleted" = true where "DeviceCode" = ${CODE}`;
    expect((await search({ ...q, deviceId })).body.code).toBe('DEVICE_NOT_FOUND');
    await ctx.sql`update "Devices" set "IsDeleted" = false, "Status" = 4 where "DeviceCode" = ${CODE}`;
    expect((await search({ ...q, deviceId })).status).toBe(200);
  });

  it('400 INVALID_RANGE for too old, over 24 h, and malformed input', async () => {
    const earliest = earliestRecordingFrom(new Date());
    const old = new Date(earliest.getTime() - 1000);
    const tooOld = await search({ deviceId, from: old.toISOString(), to: new Date(old.getTime() + 3_600_000).toISOString() });
    expect(tooOld.status).toBe(400);
    expect(tooOld.body.code).toBe('INVALID_RANGE');
    const from = new Date(Date.now() - 30 * 3_600_000);
    const tooLong = await search({ deviceId, from: from.toISOString(), to: new Date(from.getTime() + 25 * 3_600_000).toISOString() });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.code).toBe('INVALID_RANGE');
    expect((await search({ deviceId: 'abc', from: from.toISOString(), to: new Date().toISOString() })).status).toBe(400);
    expect((await search({ deviceId, from: 'nope', to: new Date().toISOString() })).status).toBe(400);
  });

  it('502 RECORDING_SEARCH_FAILED without provider text when the provider throws', async () => {
    vi.spyOn(provider, 'search').mockRejectedValue(new Error('secret-vendor-detail'));
    const res = await search({ deviceId, from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date().toISOString() });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('RECORDING_SEARCH_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('secret-vendor-detail');
  });

  it('writes a SEARCH_RECORDINGS audit row', async () => {
    await search({ deviceId, from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date().toISOString() });
    const rows = await eventually(async () => {
      const found = await ctx.sql`select "Action", "ResourceType" from "AuditLogs" where "ActorUsername" = ${`${PREFIX}operator`} and "Action" = 'SEARCH_RECORDINGS'`;
      return found.length ? found : null;
    });
    expect(rows[0].ResourceType).toBe('Devices');
  });
});

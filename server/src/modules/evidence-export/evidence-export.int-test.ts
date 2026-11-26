import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { EVIDENCE_EXPORT_QUEUE } from '../../common/queue/queue.module';
import { SettingsService } from '../../common/settings/settings.service';
import { bearerFor, bootHttpContext, createTestUsers, dropTestUsers, type HttpContext } from '../../test/int-helpers';

const PREFIX = 't_evx_';
const CODE = 'TEST-EVX-CAM';
const PASSWORD = 'Test@12345';
let ctx: HttpContext;
let operator: string;
let viewer: string;
let quota1: string;
let quota2: string;
let leader: string;
let add: ReturnType<typeof vi.fn>;
let storageDir: string;

const win = (minutes = 60) => {
  const end = new Date(Date.now() - 3_600_000);
  end.setMilliseconds(0);
  return { startAt: new Date(end.getTime() - minutes * 60_000).toISOString(), endAt: end.toISOString() };
};
const post = (body: Record<string, unknown> = {}, auth = operator) =>
  ctx.http.post('/api/evidence-exports').set('Authorization', auth).send({ deviceCode: CODE, ...win(), ...body });
const rows = () => ctx.sql`select * from "EvidenceExports" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE}) order by "Id"`;

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), 'evx-int-'));
  vi.stubEnv('STORAGE_LOCAL_DIR', storageDir);
  vi.stubEnv('EVIDENCE_EXPORT_RATE_LIMIT_PER_HOUR', '100000'); // per-IP counter lives in Redis and survives runs
  ctx = await bootHttpContext();
  add = vi.fn().mockResolvedValue({});
  const queue = ctx.app.get(EVIDENCE_EXPORT_QUEUE);
  expect(queue).toBeTruthy();
  (queue as { add: unknown }).add = add;
  await ctx.sql`delete from "EvidenceExports" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
  await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
  await ctx.sql`insert into "Devices" ("DeviceCode", "VendorDeviceId", "Name", "Kind") values (${CODE}, 'vendor-test-evx', 'Test export camera', 1)`;
  await createTestUsers(ctx.sql, [
    { username: `${PREFIX}operator`, role: 'OPERATOR' },
    { username: `${PREFIX}quota1`, role: 'OPERATOR' },
    { username: `${PREFIX}quota2`, role: 'OPERATOR' },
    { username: `${PREFIX}viewer`, role: 'VIEWER' },
    { username: `${PREFIX}leader`, role: 'TEAM_LEADER' },
  ], await hashPassword(PASSWORD));
  operator = await bearerFor(ctx.http, `${PREFIX}operator`, PASSWORD);
  quota1 = await bearerFor(ctx.http, `${PREFIX}quota1`, PASSWORD);
  quota2 = await bearerFor(ctx.http, `${PREFIX}quota2`, PASSWORD);
  viewer = await bearerFor(ctx.http, `${PREFIX}viewer`, PASSWORD);
  leader = await bearerFor(ctx.http, `${PREFIX}leader`, PASSWORD);
});

beforeEach(async () => {
  add.mockClear();
  await ctx.sql`delete from "EvidenceExports" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
  await ctx.sql`update "Devices" set "StreamingEnabled" = true, "Status" = 1, "IsDeleted" = false where "DeviceCode" = ${CODE}`;
  const settings = ctx.app.get(SettingsService);
  await ctx.sql`update "Settings" set "SettingValue" = 'true' where "SettingKey" = 'streaming.enabled'`;
  await ctx.sql`update "Settings" set "SettingValue" = '120' where "SettingKey" = 'streaming.download-max-minutes'`;
  settings.invalidate('streaming.enabled');
  settings.invalidate('streaming.download-max-minutes');
});

afterAll(async () => {
  if (ctx) {
    await ctx.sql`delete from "EvidenceExports" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
    await ctx.sql`delete from "AuditLogs" where "ActorUsername" like ${`${PREFIX}%`}`;
    await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
    await dropTestUsers(ctx.sql, [`${PREFIX}%`]);
    await ctx.close();
  }
  vi.unstubAllEnvs();
  rmSync(storageDir, { recursive: true, force: true });
});

describe('POST /api/evidence-exports', () => {
  it('creates a Queued row and one job, repeat gives the same row and the same job id', async () => {
    const w = win();
    const a = await post(w);
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ status: 1, progress: 0, fileName: null, fileSizeBytes: null, startAt: w.startAt, endAt: w.endAt });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][2]).toMatchObject({ jobId: `evidence-export-${a.body.id}` });
    const b = await post(w);
    expect(b.body.id).toBe(a.body.id);
    expect((await rows()).length).toBe(1);
    // adding an existing job id is a BullMQ no-op, so a repeat may re-add but never with another id
    expect(add.mock.calls.every((c) => c[2].jobId === `evidence-export-${a.body.id}`)).toBe(true);
  });

  it('two parallel requests for the same range share one row', async () => {
    const w = win();
    const [a, b, c] = await Promise.all([post(w), post(w), post(w)]);
    expect(new Set([a.body.id, b.body.id, c.body.id]).size).toBe(1);
    expect((await rows()).length).toBe(1);
  });

  it('reuses Ready-unexpired, but not Ready-expired, Failed or Expired', async () => {
    const w = win();
    const first = await post(w);
    await ctx.sql`update "EvidenceExports" set "Status" = 3, "ExpiresAt" = now() + interval '1 hour', "CompletedAt" = now() where "Id" = ${first.body.id}`;
    expect((await post(w)).body.id).toBe(first.body.id);

    await ctx.sql`update "EvidenceExports" set "ExpiresAt" = now() - interval '1 minute' where "Id" = ${first.body.id}`;
    const second = await post(w);
    expect(second.body.id).not.toBe(first.body.id);

    await ctx.sql`update "EvidenceExports" set "Status" = 4 where "Id" = ${second.body.id}`;
    const third = await post(w);
    expect(third.body.id).not.toBe(second.body.id);

    await ctx.sql`update "EvidenceExports" set "Status" = 5 where "Id" = ${third.body.id}`;
    expect((await post(w)).body.id).not.toBe(third.body.id);
  });

  it('still returns the row when the queue is down', async () => {
    add.mockRejectedValueOnce(new Error('redis down'));
    const res = await post();
    expect(res.status).toBe(201);
    expect((await rows()).length).toBe(1);
  });

  it('rejects a range over the cap with INVALID_RANGE naming the minutes', async () => {
    const res = await post(win(121));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_RANGE');
    expect(res.body.message).toContain('120');
    expect(add).not.toHaveBeenCalled();
  });

  it('device rules: deleted 404, retired ok, streaming disabled 403, system switch 403', async () => {
    await ctx.sql`update "Devices" set "IsDeleted" = true where "DeviceCode" = ${CODE}`;
    expect((await post()).status).toBe(404);
    await ctx.sql`update "Devices" set "IsDeleted" = false, "Status" = 4 where "DeviceCode" = ${CODE}`;
    expect((await post()).status).toBe(201);
    await ctx.sql`delete from "EvidenceExports" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
    await ctx.sql`update "Devices" set "StreamingEnabled" = false where "DeviceCode" = ${CODE}`;
    const off = await post();
    expect(off.status).toBe(403);
    expect(off.body.code).toBe('DEVICE_STREAM_DISABLED');
    await ctx.sql`update "Devices" set "StreamingEnabled" = true where "DeviceCode" = ${CODE}`;
    await ctx.sql`update "Settings" set "SettingValue" = 'false' where "SettingKey" = 'streaming.enabled'`;
    ctx.app.get(SettingsService).invalidate('streaming.enabled');
    const sys = await post();
    expect(sys.status).toBe(403);
    expect(sys.body.code).toBe('STREAMING_DISABLED');
  });

  it('VIEWER and TEAM_LEADER are forbidden', async () => {
    expect((await post({}, viewer)).status).toBe(403);
    expect((await post({}, leader)).status).toBe(403);
    expect((await ctx.http.get('/api/evidence-exports/policy').set('Authorization', viewer)).status).toBe(403);
  });

  it('writes an audit row', async () => {
    const res = await post();
    expect(res.status).toBe(201);
    const audit = await ctx.sql`select 1 from "AuditLogs" where "ActorUsername" = ${`${PREFIX}operator`} and "Action" = 'REQUEST_EVIDENCE_EXPORT'`;
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });
});

describe('export quota', () => {
  it('is counted per user: two users from the same IP each get their own quota', async () => {
    vi.stubEnv('EVIDENCE_EXPORT_RATE_LIMIT_PER_HOUR', '1');
    try {
      expect((await post(win(30), quota1)).status).toBe(201);
      const again = await post(win(31), quota1);
      expect(again.status).toBe(429);
      expect((await post(win(32), quota2)).status).toBe(201);
      expect((await post(win(33), quota2)).status).toBe(429);
    } finally {
      vi.stubEnv('EVIDENCE_EXPORT_RATE_LIMIT_PER_HOUR', '100000');
    }
  });
});

describe('GET policy and :id', () => {
  it('policy returns the cap', async () => {
    const res = await ctx.http.get('/api/evidence-exports/policy').set('Authorization', operator);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ maxMinutes: 120 });
  });

  it('get returns the view, unknown id is 404 EXPORT_NOT_FOUND', async () => {
    const a = await post();
    const res = await ctx.http.get(`/api/evidence-exports/${a.body.id}`).set('Authorization', operator);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(a.body.id);
    const miss = await ctx.http.get('/api/evidence-exports/999999999').set('Authorization', operator);
    expect(miss.status).toBe(404);
    expect(miss.body.code).toBe('EXPORT_NOT_FOUND');
  });
});

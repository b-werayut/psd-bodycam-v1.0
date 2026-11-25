import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { SettingsService } from '../../common/settings/settings.service';
import { bearerFor, bootHttpContext, createTestUsers, dropTestUsers, type HttpContext } from '../../test/int-helpers';
import { LiveStreamProvider } from './live-stream.provider';

const PREFIX = 't_stream_';
const CODE = 'TEST-LIVE-WALL';
const PASSWORD = 'Test@12345';
let ctx: HttpContext;
let owner: string;
let other: string;
let leader: string;
let provider: LiveStreamProvider;
let originalSettings: { key: string; value: string | null }[];
const start = (auth = owner) => ctx.http.post('/api/streams/live').set('Authorization', auth).send({ deviceCode: CODE });
const setting = async (key: string, value: string) => {
  await ctx.sql`update "Settings" set "SettingValue" = ${value} where "SettingKey" = ${key}`;
  ctx.app.get(SettingsService).invalidate(key);
};

beforeAll(async () => {
  vi.stubEnv('STREAM_ALLOWED_HOSTS', 'media.test');
  ctx = await bootHttpContext();
  originalSettings = await ctx.sql`select "SettingKey" as key, "SettingValue" as value from "Settings" where "Category" = 'streaming'`;
  await ctx.sql`delete from "StreamingSessions" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
  await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
  await ctx.sql`insert into "Devices" ("DeviceCode", "VendorDeviceId", "Name", "Kind") values (${CODE}, 'vendor-test-live', 'Test live camera', 1)`;
  await createTestUsers(ctx.sql, [
    { username: `${PREFIX}owner`, role: 'OPERATOR' },
    { username: `${PREFIX}other`, role: 'OPERATOR' },
    { username: `${PREFIX}leader`, role: 'TEAM_LEADER' },
  ], await hashPassword(PASSWORD));
  owner = await bearerFor(ctx.http, `${PREFIX}owner`, PASSWORD);
  other = await bearerFor(ctx.http, `${PREFIX}other`, PASSWORD);
  leader = await bearerFor(ctx.http, `${PREFIX}leader`, PASSWORD);
  provider = ctx.app.get(LiveStreamProvider);
});

beforeEach(async () => {
  await ctx.sql`delete from "StreamingSessions" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
  await ctx.sql`update "Devices" set "StreamingEnabled" = true, "Status" = 1 where "DeviceCode" = ${CODE}`;
  await setting('streaming.enabled', 'true');
  await setting('streaming.max-concurrent-per-user', '3');
  vi.spyOn(provider, 'requestLive').mockResolvedValue({ vendorUrl: 'https://media.test/live/index.m3u8', vendorSessionId: 'vendor-test-live$1$0$0' });
  vi.spyOn(provider, 'fetchMedia').mockImplementation(async (url) => ({
    url, status: 200, contentRange: null,
    contentType: url.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
    body: url.endsWith('.m3u8') ? Buffer.from('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nseg.ts\n') : Buffer.from([0, 1, 255]),
  }));
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  if (ctx) {
    await ctx.sql`delete from "StreamingSessions" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
    await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
    for (const row of originalSettings ?? []) await setting(row.key, row.value ?? '');
    await dropTestUsers(ctx.sql, [`${PREFIX}%`]);
    await ctx.close();
  }
  vi.unstubAllEnvs();
});

describe('live wall HTTP sessions', () => {
  it('requires auth and wall permission, validates the body before contacting DSS', async () => {
    expect((await ctx.http.post('/api/streams/live').send({ deviceCode: CODE })).status).toBe(401);
    expect((await start(leader)).status).toBe(403);
    expect((await ctx.http.post('/api/streams/live').set('Authorization', owner).send({ deviceCode: CODE, channel: 2 })).status).toBe(400);
    expect(provider.requestLive).not.toHaveBeenCalled();
  });
  it('opens a real provider ticket and proxies playlists, encryption keys and binary segments', async () => {
    const opened = await start();
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ protocol: 1, channel: 1, device: { deviceCode: CODE } });
    expect(opened.body.playbackUrl).not.toContain('media.test');
    const playlist = await ctx.http.get(opened.body.playbackUrl);
    expect(playlist.status).toBe(200);
    expect(playlist.text).toContain('#EXTM3U');
    expect(playlist.text).not.toContain('media.test');
    const refs = [...playlist.text.matchAll(/\/api\/streams\/[^"\s]+/g)].map((m) => m[0]);
    expect(refs).toHaveLength(2);
    const segment = await ctx.http.get(refs[1]);
    expect(segment.status).toBe(200);
    expect(segment.body).toEqual(Buffer.from([0, 1, 255]));
    expect((await ctx.http.get(refs[0])).status).toBe(200);
    expect((await ctx.http.get('/api/streams/sessions').set('Authorization', owner)).body.data).toHaveLength(1);
  });
  it('stops only the owner session, idempotently, and revokes its media URL', async () => {
    const { body: session } = await start();
    const path = `/api/streams/${session.sessionToken}/stop`;
    expect((await ctx.http.post(path).set('Authorization', other)).status).toBe(404);
    expect((await ctx.http.post(path).set('Authorization', owner)).status).toBe(200);
    expect((await ctx.http.post(path).set('Authorization', owner)).status).toBe(200);
    expect((await ctx.http.get(session.playbackUrl)).status).toBe(404);
  });
  it('enforces the quota atomically for simultaneous requests and releases failed reservations', async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, () => start()));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 429]);
    expect(provider.requestLive).toHaveBeenCalledTimes(3);
    for (const response of responses.filter((r) => r.status === 200)) await ctx.http.post(`/api/streams/${response.body.sessionToken}/stop`).set('Authorization', owner);
    vi.mocked(provider.requestLive).mockRejectedValueOnce(new Error('vendor unavailable'));
    expect((await start()).status).toBe(502);
    expect((await start()).status).toBe(200);
  });
  it('rejects tampering and cross-session URL reuse', async () => {
    const a = (await start()).body;
    const b = (await start()).body;
    expect((await ctx.http.get(a.playbackUrl.replace(a.sessionToken, b.sessionToken))).status).toBe(404);
    expect((await ctx.http.get(`${a.playbackUrl.slice(0, -3)}AAA`)).status).toBe(404);
  });
  it('ends idle streams and frees the quota', async () => {
    const session = (await start()).body;
    await ctx.sql`update "StreamingSessions" set "LastAccessAt" = now() - interval '10 minutes' where "SessionToken" = ${session.sessionToken}`;
    expect((await ctx.http.get(session.playbackUrl)).status).toBe(404);
    const [row] = await ctx.sql`select "Status", "EndReason" from "StreamingSessions" where "SessionToken" = ${session.sessionToken}`;
    expect(row).toMatchObject({ Status: 3, EndReason: 2 });
  });
  it('checks current device and account policy on every media request', async () => {
    const session = (await start()).body;
    await ctx.sql`update "Devices" set "StreamingEnabled" = false where "DeviceCode" = ${CODE}`;
    expect((await ctx.http.get(session.playbackUrl)).status).toBe(404);
    expect((await start()).status).toBe(403);
    await ctx.sql`update "Devices" set "StreamingEnabled" = true where "DeviceCode" = ${CODE}`;
    const next = (await start()).body;
    await ctx.sql`update "Users" set "Status" = 2 where "Username" = ${`${PREFIX}owner`}`;
    try { expect((await ctx.http.get(next.playbackUrl)).status).toBe(404); }
    finally { await ctx.sql`update "Users" set "Status" = 1 where "Username" = ${`${PREFIX}owner`}`; }
  });
  it('records each start and stop in the audit log', async () => {
    const session = (await start()).body;
    await ctx.http.post(`/api/streams/${session.sessionToken}/stop`).set('Authorization', owner);
    const rows = await ctx.sql`select "Action" from "AuditLogs" where "ActorUsername" = ${`${PREFIX}owner`} and "Action" in ('START_LIVE_STREAM', 'STOP_LIVE_STREAM')`;
    expect(rows.map((r) => r.Action)).toEqual(expect.arrayContaining(['START_LIVE_STREAM', 'STOP_LIVE_STREAM']));
  });
});

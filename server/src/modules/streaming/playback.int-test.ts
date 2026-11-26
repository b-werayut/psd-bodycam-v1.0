import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { SettingsService } from '../../common/settings/settings.service';
import { bearerFor, bootHttpContext, createTestUsers, dropTestUsers, type HttpContext } from '../../test/int-helpers';
import { LiveStreamProvider } from './live-stream.provider';
import { RecordingProvider } from './recording-provider';
import { earliestRecordingFrom } from './recording-range';

const PREFIX = 't_play_';
const CODE = 'TEST-PLAY-CAM';
const PASSWORD = 'Test@12345';
let ctx: HttpContext;
let operator: string;
let viewer: string;
let leader: string;
let recordings: RecordingProvider;
let live: LiveStreamProvider;
let originalSettings: { key: string; value: string | null }[];

const setting = async (key: string, value: string) => {
  await ctx.sql`update "Settings" set "SettingValue" = ${value} where "SettingKey" = ${key}`;
  ctx.app.get(SettingsService).invalidate(key);
};
const windowOf = () => {
  const end = new Date(Date.now() - 3_600_000);
  return { startAt: new Date(end.getTime() - 3_600_000).toISOString(), endAt: end.toISOString() };
};
const play = (body: Record<string, unknown> = {}, auth = operator) =>
  ctx.http.post('/api/streams/playback').set('Authorization', auth).send({ deviceCode: CODE, ...windowOf(), ...body });
const rows = () => ctx.sql`select * from "StreamingSessions" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE}) order by "Id"`;

beforeAll(async () => {
  vi.stubEnv('STREAM_ALLOWED_HOSTS', 'media.test');
  ctx = await bootHttpContext();
  originalSettings = await ctx.sql`select "SettingKey" as key, "SettingValue" as value from "Settings" where "Category" = 'streaming'`;
  await ctx.sql`delete from "StreamingSessions" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
  await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
  await ctx.sql`insert into "Devices" ("DeviceCode", "VendorDeviceId", "Name", "Kind") values (${CODE}, 'vendor-test-play', 'Test playback camera', 1)`;
  await createTestUsers(ctx.sql, [
    { username: `${PREFIX}operator`, role: 'OPERATOR' },
    { username: `${PREFIX}viewer`, role: 'VIEWER' },
    { username: `${PREFIX}leader`, role: 'TEAM_LEADER' },
  ], await hashPassword(PASSWORD));
  operator = await bearerFor(ctx.http, `${PREFIX}operator`, PASSWORD);
  viewer = await bearerFor(ctx.http, `${PREFIX}viewer`, PASSWORD);
  leader = await bearerFor(ctx.http, `${PREFIX}leader`, PASSWORD);
  recordings = ctx.app.get(RecordingProvider);
  live = ctx.app.get(LiveStreamProvider);
});

beforeEach(async () => {
  await ctx.sql`delete from "StreamingSessions" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
  await ctx.sql`update "Devices" set "StreamingEnabled" = true, "Status" = 1, "IsDeleted" = false where "DeviceCode" = ${CODE}`;
  await setting('streaming.enabled', 'true');
  await setting('streaming.max-concurrent-per-user', '3');
  vi.spyOn(recordings, 'requestPlayback').mockResolvedValue({ vendorUrl: 'http://media.test/x.m3u8', vendorSessionId: 'V$1$0$0' });
  vi.spyOn(live, 'requestLive').mockResolvedValue({ vendorUrl: 'https://media.test/live/index.m3u8', vendorSessionId: 'vendor-test-play$1$0$0' });
  vi.spyOn(live, 'fetchMedia').mockImplementation(async (url) => ({
    url, status: 200, contentRange: null, contentType: 'application/vnd.apple.mpegurl',
    body: Buffer.from('#EXTM3U\n#EXTINF:4,\nseg.ts\n#EXT-X-ENDLIST\n'),
  }));
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  if (ctx) {
    await ctx.sql`delete from "StreamingSessions" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
    await ctx.sql`delete from "AuditLogs" where "ActorUsername" like ${`${PREFIX}%`}`;
    await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
    for (const row of originalSettings ?? []) await setting(row.key, row.value ?? '');
    await dropTestUsers(ctx.sql, [`${PREFIX}%`]);
    await ctx.close();
  }
  vi.unstubAllEnvs();
});

describe('POST /api/streams/playback', () => {
  it('opens a playback session (type 2) with the requested window and lists it', async () => {
    const w = windowOf();
    const res = await play(w);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ protocol: 1, channel: 1, device: { deviceCode: CODE } });
    expect(res.body.playbackUrl).toContain(`/api/streams/${res.body.sessionToken}/playlist.m3u8`);
    expect(res.body.idleTimeoutSeconds).toBeGreaterThan(0);
    const [row] = await rows();
    expect(row.SessionType).toBe(2);
    expect(row.Status).toBe(2);
    expect(new Date(row.PlaybackStartAt).toISOString()).toBe(w.startAt);
    expect(new Date(row.PlaybackEndAt).toISOString()).toBe(w.endAt);
    expect(recordings.requestPlayback).toHaveBeenCalledWith('vendor-test-play', new Date(w.startAt), new Date(w.endAt));
    const list = await ctx.http.get('/api/streams/sessions').set('Authorization', operator);
    expect(list.body.data[0].sessionType).toBe(2);
    const media = await ctx.http.get(res.body.playbackUrl);
    expect(media.status).toBe(200);
    expect(media.text).toContain('#EXT-X-ENDLIST');
  });

  it('live rows report sessionType 1', async () => {
    await ctx.http.post('/api/streams/live').set('Authorization', operator).send({ deviceCode: CODE });
    const list = await ctx.http.get('/api/streams/sessions').set('Authorization', operator);
    expect(list.body.data[0].sessionType).toBe(1);
  });

  it('400 INVALID_RANGE for over 24 h, older than 30 days, and the future; 400 for a bad body', async () => {
    const end = new Date(Date.now() - 60_000);
    const over = await play({ startAt: new Date(end.getTime() - 25 * 3_600_000).toISOString(), endAt: end.toISOString() });
    expect(over.status).toBe(400);
    expect(over.body.code).toBe('INVALID_RANGE');
    const old = new Date(earliestRecordingFrom(new Date()).getTime() - 1000);
    const tooOld = await play({ startAt: old.toISOString(), endAt: new Date(old.getTime() + 3_600_000).toISOString() });
    expect(tooOld.body.code).toBe('INVALID_RANGE');
    const future = await play({ startAt: new Date(Date.now() + 3_600_000).toISOString(), endAt: new Date(Date.now() + 7_200_000).toISOString() });
    expect(future.status).toBe(400);
    expect(future.body.code).toBe('INVALID_RANGE');
    expect((await play({ startAt: 'nope' })).status).toBe(400);
    expect((await play({ channel: 2 })).status).toBe(400);
    expect(recordings.requestPlayback).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(0);
  });

  it('no recordings => 404 RECORDING_NOT_FOUND and the row is FAILED', async () => {
    vi.mocked(recordings.requestPlayback).mockResolvedValue('no-recordings');
    const res = await play();
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('RECORDING_NOT_FOUND');
    const [row] = await rows();
    expect(row.Status).toBe(4);
    expect(row.EndReason).toBe(3);
  });

  it('provider failure => 502 PLAYBACK_START_FAILED without provider text, row FAILED', async () => {
    vi.mocked(recordings.requestPlayback).mockRejectedValue(new Error('secret-vendor-detail'));
    const res = await play();
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('PLAYBACK_START_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('secret-vendor-detail');
    expect((await rows())[0].Status).toBe(4);
  });

  it('allows retired cameras, refuses streaming-disabled cameras and the global switch, 404 for unknown/deleted', async () => {
    await ctx.sql`update "Devices" set "Status" = 4 where "DeviceCode" = ${CODE}`;
    const retired = await play();
    expect(retired.status).toBe(200);
    expect((await ctx.http.get(retired.body.playbackUrl)).status).toBe(200);
    await ctx.sql`update "Devices" set "Status" = 1 where "DeviceCode" = ${CODE}`;
    const liveOpen = await ctx.http.post('/api/streams/live').set('Authorization', operator).send({ deviceCode: CODE });
    expect(liveOpen.status).toBe(200);
    await ctx.sql`update "Devices" set "Status" = 4 where "DeviceCode" = ${CODE}`;
    expect((await ctx.http.get(liveOpen.body.playbackUrl)).status).toBe(404);
    await ctx.sql`delete from "StreamingSessions" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
    await ctx.sql`update "Devices" set "Status" = 1, "StreamingEnabled" = false where "DeviceCode" = ${CODE}`;
    const off = await play();
    expect(off.status).toBe(403);
    expect(off.body.code).toBe('DEVICE_STREAM_DISABLED');
    await ctx.sql`update "Devices" set "StreamingEnabled" = true where "DeviceCode" = ${CODE}`;
    await setting('streaming.enabled', 'false');
    const disabled = await play();
    expect(disabled.status).toBe(403);
    expect(disabled.body.code).toBe('STREAMING_DISABLED');
    expect(disabled.body.message).toBe('ระบบปิดการดูวิดีโอไว้');
    await setting('streaming.enabled', 'true');
    expect((await play({ deviceCode: 'NO-SUCH-CAM' })).body.code).toBe('DEVICE_NOT_FOUND');
    await ctx.sql`update "Devices" set "IsDeleted" = true where "DeviceCode" = ${CODE}`;
    expect((await play()).body.code).toBe('DEVICE_NOT_FOUND');
  });

  it('counts live and playback sessions in the same quota', async () => {
    await setting('streaming.max-concurrent-per-user', '1');
    expect((await ctx.http.post('/api/streams/live').set('Authorization', operator).send({ deviceCode: CODE })).status).toBe(200);
    const res = await play();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('STREAM_QUOTA_EXCEEDED');
  });

  it('refuses VIEWER, TEAM_LEADER and anonymous callers', async () => {
    expect((await ctx.http.post('/api/streams/playback').send({ deviceCode: CODE, ...windowOf() })).status).toBe(401);
    expect((await play({}, viewer)).status).toBe(403);
    expect((await play({}, leader)).status).toBe(403);
    expect(recordings.requestPlayback).not.toHaveBeenCalled();
  });

  it('media of a playback row needs playback:view only; a live row needs streaming:view-live', async () => {
    const grant = `select rp."RoleId" as role, rp."PermissionId" as perm from "RolePermissions" rp join "Permissions" p on p."Id" = rp."PermissionId" join "Roles" r on r."Id" = rp."RoleId" where r."Code" = 'OPERATOR' and p."Code" = 'streaming:view-live'`;
    const [row] = await ctx.sql.unsafe(grant);
    expect(row).toBeTruthy();
    const playback = await play();
    const liveSession = await ctx.http.post('/api/streams/live').set('Authorization', operator).send({ deviceCode: CODE });
    expect(playback.status).toBe(200);
    expect(liveSession.status).toBe(200);
    await ctx.sql`delete from "RolePermissions" where "RoleId" = ${row.role} and "PermissionId" = ${row.perm}`;
    try {
      expect((await ctx.http.get(playback.body.playbackUrl)).status).toBe(200);
      expect((await ctx.http.get(liveSession.body.playbackUrl)).status).toBe(404);
    } finally {
      await ctx.sql`insert into "RolePermissions" ("RoleId", "PermissionId") values (${row.role}, ${row.perm}) on conflict do nothing`;
    }
  });

  it('stop ends the playback row and revokes its media URL', async () => {
    const res = await play();
    const stop = await ctx.http.post(`/api/streams/${res.body.sessionToken}/stop`).set('Authorization', operator);
    expect(stop.status).toBe(200);
    expect((await rows())[0].Status).toBe(3);
    expect((await ctx.http.get(res.body.playbackUrl)).status).toBe(404);
  });

  it('writes a START_PLAYBACK audit row', async () => {
    await ctx.sql`delete from "AuditLogs" where "ActorUsername" = ${`${PREFIX}operator`} and "Action" = 'START_PLAYBACK'`;
    await play();
    await vi.waitFor(async () => {
      const found = await ctx.sql`select "ResourceType" from "AuditLogs" where "ActorUsername" = ${`${PREFIX}operator`} and "Action" = 'START_PLAYBACK'`;
      expect(found).toHaveLength(1);
      expect(found[0].ResourceType).toBe('StreamingSessions');
    });
  });

  it('a role with playback:view but without streaming:view-live can list and stop its playback session; others get 404', async () => {
    const grant = `select rp."RoleId" as role, rp."PermissionId" as perm from "RolePermissions" rp join "Permissions" p on p."Id" = rp."PermissionId" join "Roles" r on r."Id" = rp."RoleId" where r."Code" = 'OPERATOR' and p."Code" = 'streaming:view-live'`;
    const [row] = await ctx.sql.unsafe(grant);
    expect(row).toBeTruthy();
    const res = await play();
    expect(res.status).toBe(200);
    await ctx.sql`delete from "RolePermissions" where "RoleId" = ${row.role} and "PermissionId" = ${row.perm}`;
    try {
      const noLive = await bearerFor(ctx.http, `${PREFIX}operator`, PASSWORD);
      expect((await ctx.http.post('/api/streams/live').set('Authorization', noLive).send({ deviceCode: CODE })).status).toBe(403);
      const list = await ctx.http.get('/api/streams/sessions').set('Authorization', noLive);
      expect(list.status).toBe(200);
      expect(list.body.data.map((r: { sessionToken: string }) => r.sessionToken)).toEqual([res.body.sessionToken]);
      const path = `/api/streams/${res.body.sessionToken}/stop`;
      expect((await ctx.http.post(path).set('Authorization', viewer)).status).toBe(404);
      expect((await ctx.http.post(path).set('Authorization', noLive)).status).toBe(200);
      expect((await rows())[0].Status).toBe(3);
    } finally {
      await ctx.sql`insert into "RolePermissions" ("RoleId", "PermissionId") values (${row.role}, ${row.perm}) on conflict do nothing`;
    }
  });
});

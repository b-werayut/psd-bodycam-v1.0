import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../common/settings/settings.service';
import { eventually } from '../../test/int-helpers';
import { TALK_PROVIDER, TalkProviderError, type TalkProvider } from './provider/talk-provider.interface';
import { TALK_CLOSE_CODE, TALK_END_REASON, TALK_MESSAGE, TALK_STATUS, talkBusyMessage } from './talk-constants';
import { bootTalkKit, type TalkKit } from '../../test/talk-kit';
import { hashTalkTicket } from './talk-ticket';
import { TalkService } from './talk.service';

const PREFIX = 't_talk_';
let kit: TalkKit;
let talk: TalkService;
let provider: TalkProvider;
let settings: SettingsService;
const sql = () => kit.ctx.sql;

beforeAll(async () => {
  kit = await bootTalkKit(PREFIX);
  talk = kit.ctx.app.get(TalkService);
  provider = kit.ctx.app.get<TalkProvider>(TALK_PROVIDER);
  settings = kit.ctx.app.get(SettingsService);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await sql()`update "Users" set "Status" = 1 where "Username" like ${`${PREFIX}%`}`;
  await setting('streaming.enabled', 'true');
  await kit.cleanup();
});

afterAll(async () => {
  await kit?.close();
});

async function setting(key: string, value: string): Promise<void> {
  await sql()`update "Settings" set "SettingValue" = ${value} where "SettingKey" = ${key}`;
  settings.invalidate(key);
}

const talkRow = async (id: bigint | string) => (await sql()`select * from "TalkSessions" where "Id" = ${BigInt(id)}`)[0];
const stopAudits = (id: bigint | string) => sql()`
  select "ActorUsername","Changes" from "AuditLogs"
  where "Action" = 'STOP_TALK' and "ResourceType" = 'TalkSessions' and "ResourceId" = ${BigInt(id)} order by "Id"`;

async function startFor(who: 'owner' | 'other') {
  const device = await kit.makeDevice();
  const liveToken = await kit.openLive(kit.auth[who], device.code);
  const res = await kit.startTalk(kit.auth[who], liveToken);
  expect(res.status).toBe(200);
  return { device, liveToken, body: res.body, id: BigInt(res.body.talkSessionId as string) };
}

describe('start', () => {
  it('opens ACTIVE, binds the live session, stores only the SHA-256 of the ticket', async () => {
    const device = await kit.makeDevice();
    const liveToken = await kit.openLive(kit.auth.owner, device.code);
    const res = await kit.startTalk(kit.auth.owner, liveToken);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ uplinkSampleRate: 8000, downlinkSampleRate: 8000, frameMs: 40, maxSeconds: 600 });
    const ticket = new URL(`http://x${res.body.wsUrl}`).searchParams.get('ticket') as string;
    expect(res.body.wsUrl).toBe(`/api/talk/ws?ticket=${ticket}`);
    const [live] = await sql()`select "Id" from "StreamingSessions" where "SessionToken" = ${liveToken}`;
    const row = await talkRow(res.body.talkSessionId);
    expect(row).toMatchObject({
      Status: TALK_STATUS.ACTIVE,
      DeviceId: device.id,
      UserId: kit.ids.owner,
      StreamingSessionId: live.Id,
      TicketHash: hashTalkTicket(ticket),
      UplinkSampleRate: 8000,
      FrameMs: 40,
    });
    expect(row.VendorTalkId).toMatch(/^[0-9a-f]{32}$/);
    expect((row.TicketExpiresAt as Date).getTime() - (row.StartedAt as Date).getTime()).toBe(30_000);
  });

  it('maxSeconds comes from streaming.talk-max-seconds and goes to the provider', async () => {
    const device = await kit.makeDevice();
    const liveToken = await kit.openLive(kit.auth.owner, device.code);
    const [before] = await sql()`select "SettingValue" from "Settings" where "SettingKey" = 'streaming.talk-max-seconds'`;
    await setting('streaming.talk-max-seconds', '900');
    const start = vi.spyOn(provider, 'start');
    try {
      const res = await kit.startTalk(kit.auth.owner, liveToken);
      expect(res.body.maxSeconds).toBe(900);
      expect(start).toHaveBeenCalledWith({ vendorDeviceId: `VENDOR-${device.code}`, maxSeconds: 900 });
    } finally {
      await setting('streaming.talk-max-seconds', before.SettingValue as string);
    }
  });

  it('audits START_TALK without the live token and rejects a malformed token with 400', async () => {
    const device = await kit.makeDevice();
    const liveToken = await kit.openLive(kit.auth.owner, device.code);
    expect((await kit.startTalk(kit.auth.owner, liveToken)).status).toBe(200);
    const log = await eventually(async () => {
      const [row] = await sql()`
        select "Result","Changes" from "AuditLogs"
        where "Action" = 'START_TALK' and "ActorUsername" = ${`${PREFIX}owner`} order by "Id" desc limit 1`;
      return row;
    });
    expect(log.Result).toBe(1);
    expect(JSON.stringify(log.Changes)).not.toContain(liveToken);
    expect((await kit.startTalk(kit.auth.owner, 'short')).status).toBe(400);
  });

  it('role grant revoked in DB while the JWT still carries it -> 403 FORBIDDEN from the service', async () => {
    const device = await kit.makeDevice();
    const liveToken = await kit.openLive(kit.auth.owner, device.code);
    await kit.revokeTalk('OPERATOR');
    const res = await kit.startTalk(kit.auth.owner, liveToken);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('streaming.enabled = false -> 403 STREAMING_DISABLED', async () => {
    const device = await kit.makeDevice();
    const liveToken = await kit.openLive(kit.auth.owner, device.code);
    await setting('streaming.enabled', 'false');
    const res = await kit.startTalk(kit.auth.owner, liveToken);
    expect([res.status, res.body.code]).toEqual([403, 'STREAMING_DISABLED']);
  });

  it('someone else\'s live, a stopped live and a non-live session -> 404 TALK_LIVE_NOT_FOUND', async () => {
    const device = await kit.makeDevice();
    const liveToken = await kit.openLive(kit.auth.owner, device.code);
    const foreign = await kit.startTalk(kit.auth.other, liveToken);
    expect([foreign.status, foreign.body.code]).toEqual([404, 'TALK_LIVE_NOT_FOUND']);

    await kit.ctx.http.post(`/api/streams/${liveToken}/stop`).set('Authorization', kit.auth.owner);
    const stopped = await kit.startTalk(kit.auth.owner, liveToken);
    expect([stopped.status, stopped.body.code]).toEqual([404, 'TALK_LIVE_NOT_FOUND']);

    const playbackToken = 'P'.repeat(43);
    await sql()`
      insert into "StreamingSessions" ("DeviceId","UserId","SessionToken","SessionType","Status")
      values (${device.id}, ${kit.ids.owner}, ${playbackToken}, 2, 2)`;
    const playback = await kit.startTalk(kit.auth.owner, playbackToken);
    expect([playback.status, playback.body.code]).toEqual([404, 'TALK_LIVE_NOT_FOUND']);
  });

  it('device retired or streaming turned off after the live opened -> 403 DEVICE_STREAM_DISABLED', async () => {
    const a = await kit.makeDevice();
    const tokenA = await kit.openLive(kit.auth.owner, a.code);
    await sql()`update "Devices" set "Status" = 4 where "Id" = ${a.id}`;
    const retired = await kit.startTalk(kit.auth.owner, tokenA);
    expect([retired.status, retired.body.code]).toEqual([403, 'DEVICE_STREAM_DISABLED']);

    const b = await kit.makeDevice();
    const tokenB = await kit.openLive(kit.auth.owner, b.code);
    await sql()`update "Devices" set "StreamingEnabled" = false where "Id" = ${b.id}`;
    const off = await kit.startTalk(kit.auth.owner, tokenB);
    expect([off.status, off.body.code]).toEqual([403, 'DEVICE_STREAM_DISABLED']);
  });

  it('another user talking on the device -> 409 TALK_DEVICE_BUSY naming them', async () => {
    const device = await kit.makeDevice();
    const mine = await kit.openLive(kit.auth.owner, device.code);
    const theirs = await kit.openLive(kit.auth.other, device.code);
    expect((await kit.startTalk(kit.auth.owner, mine)).status).toBe(200);

    const res = await kit.startTalk(kit.auth.other, theirs);
    expect([res.status, res.body.code]).toEqual([409, 'TALK_DEVICE_BUSY']);
    expect(res.body.message).toBe(talkBusyMessage(`Test ${PREFIX}owner`));
  });

  it('own stale ACTIVE call on the same device is hung up first (provider.stop + STOP_TALK audit)', async () => {
    const device = await kit.makeDevice();
    const liveToken = await kit.openLive(kit.auth.owner, device.code);
    const first = await kit.startTalk(kit.auth.owner, liveToken);
    const firstId = BigInt(first.body.talkSessionId as string);
    const vendorTalkId = (await talkRow(firstId)).VendorTalkId as string;
    const stop = vi.spyOn(provider, 'stop');

    const second = await kit.startTalk(kit.auth.owner, liveToken);

    expect(second.status).toBe(200);
    expect(await talkRow(firstId)).toMatchObject({ Status: TALK_STATUS.ENDED, EndReason: TALK_END_REASON.USER_STOPPED });
    expect((await talkRow(second.body.talkSessionId)).Status).toBe(TALK_STATUS.ACTIVE);
    expect(stop).toHaveBeenCalledWith(vendorTalkId);
    const [log] = await stopAudits(firstId);
    expect(log.ActorUsername).toBe(`${PREFIX}owner`);
    expect(log.Changes).toMatchObject({
      endReason: TALK_END_REASON.USER_STOPPED,
      closeCode: TALK_CLOSE_CODE.STOPPED,
      closedBy: 'system',
    });
  });

  it('own REQUESTED call (still connecting) is not stolen -> 409 TALK_ALREADY_STARTING', async () => {
    const device = await kit.makeDevice();
    const liveToken = await kit.openLive(kit.auth.owner, device.code);
    const [live] = await sql()`select "Id" from "StreamingSessions" where "SessionToken" = ${liveToken}`;
    await sql()`
      insert into "TalkSessions" ("DeviceId","UserId","StreamingSessionId","Status")
      values (${device.id}, ${kit.ids.owner}, ${live.Id}, 1)`;

    const res = await kit.startTalk(kit.auth.owner, liveToken);

    expect([res.status, res.body.code, res.body.message]).toEqual([409, 'TALK_ALREADY_STARTING', TALK_MESSAGE.ALREADY_STARTING]);
    const [open] = await sql()`select count(*)::int as n from "TalkSessions" where "DeviceId" = ${device.id} and "Status" = 1`;
    expect(open.n).toBe(1);
  });

  it('middleware failure -> 502 TALK_START_FAILED, row FAILED, next start on the device is not 409', async () => {
    const device = await kit.makeDevice();
    const liveToken = await kit.openLive(kit.auth.owner, device.code);
    vi.spyOn(provider, 'start').mockRejectedValueOnce(
      new TalkProviderError(TALK_MESSAGE.RTSP_FAILED, 1002, 'FastAPI refused start (code=1002) raw detail'),
    );

    const first = await kit.startTalk(kit.auth.owner, liveToken);

    expect([first.status, first.body.code]).toEqual([502, 'TALK_START_FAILED']);
    expect(first.body.message).toBe(TALK_MESSAGE.RTSP_FAILED);
    const [failed] = await sql()`select * from "TalkSessions" where "DeviceId" = ${device.id}`;
    expect(failed).toMatchObject({
      Status: TALK_STATUS.FAILED,
      EndReason: TALK_END_REASON.VENDOR_ERROR,
      TicketHash: null,
      VendorTalkId: null,
      DurationSeconds: null,
    });
    expect(failed.ErrorMessage).toContain('code=1002');
    expect((await kit.startTalk(kit.auth.owner, liveToken)).status).toBe(200);
  });

  it('middleware says the device already has a call (1004) -> 409 TALK_DEVICE_BUSY, row FAILED', async () => {
    const device = await kit.makeDevice();
    const liveToken = await kit.openLive(kit.auth.owner, device.code);
    vi.spyOn(provider, 'start').mockRejectedValueOnce(new TalkProviderError(talkBusyMessage(null), 1004));

    const res = await kit.startTalk(kit.auth.owner, liveToken);

    expect([res.status, res.body.code, res.body.message]).toEqual([409, 'TALK_DEVICE_BUSY', talkBusyMessage(null)]);
    expect((await sql()`select "Status" from "TalkSessions" where "DeviceId" = ${device.id}`)[0].Status).toBe(TALK_STATUS.FAILED);
  });

  it('same user, second device while a call is open -> 409 TALK_USER_BUSY; after stop it works', async () => {
    const a = await kit.makeDevice();
    const b = await kit.makeDevice();
    const tokenA = await kit.openLive(kit.auth.owner, a.code);
    const tokenB = await kit.openLive(kit.auth.owner, b.code);
    const first = await kit.startTalk(kit.auth.owner, tokenA);
    expect(first.status).toBe(200);

    const busy = await kit.startTalk(kit.auth.owner, tokenB);
    expect([busy.status, busy.body.code, busy.body.message]).toEqual([409, 'TALK_USER_BUSY', TALK_MESSAGE.USER_BUSY]);
    // the first call is untouched
    expect((await talkRow(first.body.talkSessionId)).Status).toBe(TALK_STATUS.ACTIVE);

    expect((await kit.stopTalk(kit.auth.owner, first.body.talkSessionId)).status).toBe(200);
    expect((await kit.startTalk(kit.auth.owner, tokenB)).status).toBe(200);
  });

  it('two users on one device at once -> one 200, one 409 (UX_Talk_Device_Open)', async () => {
    const device = await kit.makeDevice();
    const mine = await kit.openLive(kit.auth.owner, device.code);
    const theirs = await kit.openLive(kit.auth.other, device.code);

    const results = await Promise.all([kit.startTalk(kit.auth.owner, mine), kit.startTalk(kit.auth.other, theirs)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe('TALK_DEVICE_BUSY');
    const [open] = await sql()`select count(*)::int as n from "TalkSessions" where "DeviceId" = ${device.id} and "Status" in (1, 2)`;
    expect(open.n).toBe(1);
  });

  it('one user on two devices at once -> one 200, one 409 TALK_USER_BUSY (UX_Talk_User_Open)', async () => {
    const a = await kit.makeDevice();
    const b = await kit.makeDevice();
    const tokenA = await kit.openLive(kit.auth.owner, a.code);
    const tokenB = await kit.openLive(kit.auth.owner, b.code);

    const results = await Promise.all([kit.startTalk(kit.auth.owner, tokenA), kit.startTalk(kit.auth.owner, tokenB)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe('TALK_USER_BUSY');
  });
});

describe('stop', () => {
  it('own call -> ENDED USER_STOPPED with duration, provider.stop called, STOP_TALK audited once', async () => {
    const { id, body } = await startFor('owner');
    const vendorTalkId = (await talkRow(id)).VendorTalkId as string;
    const stop = vi.spyOn(provider, 'stop');

    const res = await kit.stopTalk(kit.auth.owner, body.talkSessionId);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      talkSessionId: body.talkSessionId,
      status: TALK_STATUS.ENDED,
      endReason: TALK_END_REASON.USER_STOPPED,
      durationSeconds: expect.any(Number),
    });
    expect(stop).toHaveBeenCalledWith(vendorTalkId);
    expect((await talkRow(id)).TicketHash).toBeNull();
    const logs = await eventually(async () => {
      const rows = await stopAudits(id);
      return rows.length ? rows : null;
    });
    expect(logs).toHaveLength(1);
  });

  it('is idempotent: same result, provider not called again', async () => {
    const { body } = await startFor('owner');
    const first = await kit.stopTalk(kit.auth.owner, body.talkSessionId);
    const stop = vi.spyOn(provider, 'stop');
    const second = await kit.stopTalk(kit.auth.owner, body.talkSessionId);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(stop).not.toHaveBeenCalled();
  });

  it("someone else's call -> 404 TALK_NOT_FOUND and the call keeps going", async () => {
    const { id, body } = await startFor('owner');
    const res = await kit.stopTalk(kit.auth.other, body.talkSessionId);
    expect([res.status, res.body.code]).toEqual([404, 'TALK_NOT_FOUND']);
    expect((await talkRow(id)).Status).toBe(TALK_STATUS.ACTIVE);
  });

  it('still works after streaming:talk is revoked (LoginOnly)', async () => {
    const { body } = await startFor('owner');
    await kit.revokeTalk('OPERATOR');
    // a fresh JWT no longer carries streaming:talk, so only @LoginOnly lets this through
    const fresh = await kit.relogin('owner');
    const res = await kit.stopTalk(fresh, body.talkSessionId);
    expect([res.status, res.body.status]).toEqual([200, TALK_STATUS.ENDED]);
  });

  it('a non-numeric id -> 400', async () => {
    expect((await kit.stopTalk(kit.auth.owner, 'abc')).status).toBe(400);
  });
});

describe('consumeTicket (used by the relay)', () => {
  const ticketOf = (wsUrl: string) => new URL(`http://x${wsUrl}`).searchParams.get('ticket') as string;

  it('is one-shot: first consume returns the row, the second returns null', async () => {
    const { body, id } = await startFor('owner');
    const ticket = ticketOf(body.wsUrl);
    expect((await talk.consumeTicket(ticket))?.Id).toBe(id);
    expect(await talk.consumeTicket(ticket)).toBeNull();
  });

  it('an expired ticket -> null', async () => {
    const { body, id } = await startFor('owner');
    await sql()`update "TalkSessions" set "TicketExpiresAt" = now() - interval '1 second' where "Id" = ${id}`;
    expect(await talk.consumeTicket(ticketOf(body.wsUrl))).toBeNull();
  });

  it('a row that is no longer ACTIVE -> null', async () => {
    const { body, id } = await startFor('owner');
    await sql()`update "TalkSessions" set "Status" = 3 where "Id" = ${id}`;
    expect(await talk.consumeTicket(ticketOf(body.wsUrl))).toBeNull();
  });
});

describe('revalidate (relay, no request context)', () => {
  it('still allowed -> ok and moves LastAccessAt', async () => {
    const { id } = await startFor('owner');
    await sql()`update "TalkSessions" set "LastAccessAt" = now() - interval '40 seconds' where "Id" = ${id}`;
    expect(await talk.revalidate(id)).toEqual({ ok: true });
    expect(Date.now() - ((await talkRow(id)).LastAccessAt as Date).getTime()).toBeLessThan(5_000);
  });

  it('role loses streaming:talk -> 4006 POLICY_DISABLED + STOP_TALK audit by the owner', async () => {
    const { id } = await startFor('owner');
    await kit.revokeTalk('OPERATOR');

    expect(await talk.revalidate(id)).toEqual({ ok: false, closeCode: TALK_CLOSE_CODE.POLICY });
    expect(await talkRow(id)).toMatchObject({
      Status: TALK_STATUS.ENDED,
      EndReason: TALK_END_REASON.POLICY_DISABLED,
      TicketHash: null,
    });
    const [log] = await stopAudits(id);
    expect(log.ActorUsername).toBe(`${PREFIX}owner`);
    expect(log.Changes).toMatchObject({
      endReason: TALK_END_REASON.POLICY_DISABLED,
      closeCode: TALK_CLOSE_CODE.POLICY,
      closedBy: 'system',
    });
  });

  it('streaming.enabled turned off mid-call -> 4006 POLICY_DISABLED', async () => {
    const { id } = await startFor('owner');
    await setting('streaming.enabled', 'false');
    try {
      expect(await talk.revalidate(id)).toEqual({ ok: false, closeCode: TALK_CLOSE_CODE.POLICY });
      expect(await talkRow(id)).toMatchObject({ Status: TALK_STATUS.ENDED, EndReason: TALK_END_REASON.POLICY_DISABLED });
    } finally {
      await setting('streaming.enabled', 'true');
    }
  });

  it('owner moved to TEAM_LEADER mid-call -> 4006', async () => {
    const { id } = await startFor('owner');
    const [operator] = await sql()`select "RoleId" from "Users" where "Id" = ${kit.ids.owner}`;
    await sql()`update "Users" set "RoleId" = (select "Id" from "Roles" where "Code" = 'TEAM_LEADER') where "Id" = ${kit.ids.owner}`;
    try {
      expect(await talk.revalidate(id)).toEqual({ ok: false, closeCode: TALK_CLOSE_CODE.POLICY });
    } finally {
      await sql()`update "Users" set "RoleId" = ${operator.RoleId as bigint} where "Id" = ${kit.ids.owner}`;
    }
  });

  it('suspended user, ended live, device streaming off -> 4006', async () => {
    const a = await startFor('owner');
    await sql()`update "Users" set "Status" = 2 where "Id" = ${kit.ids.owner}`;
    expect(await talk.revalidate(a.id)).toEqual({ ok: false, closeCode: TALK_CLOSE_CODE.POLICY });
    await sql()`update "Users" set "Status" = 1 where "Id" = ${kit.ids.owner}`;

    const b = await startFor('owner');
    await kit.ctx.http.post(`/api/streams/${b.liveToken}/stop`).set('Authorization', kit.auth.owner);
    expect(await talk.revalidate(b.id)).toEqual({ ok: false, closeCode: TALK_CLOSE_CODE.POLICY });

    const c = await startFor('owner');
    await sql()`update "Devices" set "StreamingEnabled" = false where "Id" = ${c.device.id}`;
    expect(await talk.revalidate(c.id)).toEqual({ ok: false, closeCode: TALK_CLOSE_CODE.POLICY });
  });

  it('call already hung up by REST stop -> 4004 and no second audit from revalidate', async () => {
    const { id, body } = await startFor('owner');
    await kit.stopTalk(kit.auth.owner, body.talkSessionId);
    // the REST audit is written after the response: wait for it, then check revalidate adds none
    await eventually(async () => ((await stopAudits(id)).length === 1 ? true : null));
    expect(await talk.revalidate(id)).toEqual({ ok: false, closeCode: TALK_CLOSE_CODE.STOPPED });
    expect(await stopAudits(id)).toHaveLength(1);
  });
});

describe('hangUp (relay)', () => {
  it('ends the row once, audits, stops the vendor; a second call is a no-op', async () => {
    const { id } = await startFor('owner');
    const row = await talkRow(id);
    const stop = vi.spyOn(provider, 'stop');

    await talk.hangUp(row as never, TALK_END_REASON.DISCONNECTED, { closeCode: 1006, closedBy: 'browser' });
    await talk.hangUp(row as never, TALK_END_REASON.DISCONNECTED, { closeCode: 1006, closedBy: 'browser' });

    expect(await talkRow(id)).toMatchObject({ Status: TALK_STATUS.ENDED, EndReason: TALK_END_REASON.DISCONNECTED });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(await stopAudits(id)).toHaveLength(1);
  });
});

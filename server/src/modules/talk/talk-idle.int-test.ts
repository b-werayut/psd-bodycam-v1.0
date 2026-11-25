import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TALK_PROVIDER, type TalkProvider } from './provider/talk-provider.interface';
import { TALK_END_REASON, TALK_STATUS } from './talk-constants';
import { bootTalkKit, type TalkKit } from '../../test/talk-kit';
import { TalkService } from './talk.service';

const PREFIX = 't_talkidle_';
let kit: TalkKit;
let talk: TalkService;
let provider: TalkProvider;
const sql = () => kit.ctx.sql;

beforeAll(async () => {
  kit = await bootTalkKit(PREFIX);
  talk = kit.ctx.app.get(TalkService);
  talk.onModuleDestroy(); // stop the app's own 30 s sweep so it cannot race the explicit calls below
  provider = kit.ctx.app.get<TalkProvider>(TALK_PROVIDER);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await kit.cleanup();
});
afterAll(async () => {
  await kit?.close();
});

/** Insert a stuck call straight into the DB: API died mid-call / browser never connected the WS. */
async function makeTalk(options: {
  status: number;
  requestedAgoSeconds: number;
  lastAccessAgoSeconds: number | null;
}): Promise<bigint> {
  const device = await kit.makeDevice();
  const [live] = await sql()`
    insert into "StreamingSessions" ("DeviceId","UserId","SessionToken","SessionType","Status")
    values (${device.id}, ${kit.ids.owner}, ${`idle-${device.code}`.padEnd(43, 'x')}, 1, 2) returning "Id"`;
  const active = options.status === TALK_STATUS.ACTIVE;
  const ago = (s: number) => sql()`now() - (${s}::int * interval '1 second')`;
  const [row] = await sql()`
    insert into "TalkSessions" ("DeviceId","UserId","StreamingSessionId","Status","VendorTalkId","RequestedAt","StartedAt","LastAccessAt")
    values (
      ${device.id}, ${kit.ids.owner}, ${live.Id}, ${options.status}, ${active ? `idle-${device.code}` : null},
      ${ago(options.requestedAgoSeconds)},
      ${active ? ago(options.requestedAgoSeconds) : null},
      ${options.lastAccessAgoSeconds === null ? null : ago(options.lastAccessAgoSeconds)})
    returning "Id"`;
  return row.Id as bigint;
}

const talkRow = async (id: bigint) => (await sql()`select * from "TalkSessions" where "Id" = ${id}`)[0];

describe('TalkIdle: expireStaleTalks', () => {
  it('ACTIVE with LastAccessAt older than 60 s -> EXPIRED + provider.stop + STOP_TALK audit', async () => {
    const id = await makeTalk({ status: TALK_STATUS.ACTIVE, requestedAgoSeconds: 120, lastAccessAgoSeconds: 61 });
    const stop = vi.spyOn(provider, 'stop');

    expect(await talk.expireStaleTalks()).toBeGreaterThanOrEqual(1);

    const row = await talkRow(id);
    expect(row).toMatchObject({ Status: TALK_STATUS.ENDED, EndReason: TALK_END_REASON.EXPIRED });
    expect(row.DurationSeconds).toBeGreaterThanOrEqual(119);
    expect(stop).toHaveBeenCalledWith(row.VendorTalkId);
    const [log] = await sql()`select "Changes" from "AuditLogs" where "Action" = 'STOP_TALK' and "ResourceId" = ${id}`;
    expect(log.Changes).toMatchObject({ endReason: TALK_END_REASON.EXPIRED, closeCode: null, closedBy: 'system' });
  });

  it('REQUESTED stuck (no LastAccessAt) is judged by RequestedAt -> EXPIRED, no duration', async () => {
    const id = await makeTalk({ status: TALK_STATUS.REQUESTED, requestedAgoSeconds: 61, lastAccessAgoSeconds: null });
    await talk.expireStaleTalks();
    expect(await talkRow(id)).toMatchObject({
      Status: TALK_STATUS.ENDED,
      EndReason: TALK_END_REASON.EXPIRED,
      DurationSeconds: null,
    });
  });

  it('a call whose relay touched LastAccessAt 30 s ago is left alone', async () => {
    const id = await makeTalk({ status: TALK_STATUS.ACTIVE, requestedAgoSeconds: 300, lastAccessAgoSeconds: 30 });
    await talk.expireStaleTalks();
    expect((await talkRow(id)).Status).toBe(TALK_STATUS.ACTIVE);
  });

  it('onModuleInit schedules the 30 s sweep with an unref timer and onModuleDestroy clears it', () => {
    vi.useFakeTimers();
    try {
      const fresh = Object.create(TalkService.prototype) as TalkService;
      const sweep = vi.spyOn(fresh, 'expireStaleTalks').mockResolvedValue(0);
      fresh.onModuleInit();
      vi.advanceTimersByTime(29_999);
      expect(sweep).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(sweep).toHaveBeenCalledTimes(1);
      fresh.onModuleDestroy();
      vi.advanceTimersByTime(60_000);
      expect(sweep).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

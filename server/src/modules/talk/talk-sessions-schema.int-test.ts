import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { bootHttpContext, createTestUsers, dropTestUsers, type HttpContext } from '../../test/int-helpers';

const PREFIX = 't_talkschema_';
const CODE_A = 'CAM-IT-TALK-A';
const CODE_B = 'CAM-IT-TALK-B';

let ctx: HttpContext;
let userId: bigint;
let deviceA: bigint;
let deviceB: bigint;
let liveA: bigint;
let liveB: bigint;

async function removeDevices(): Promise<void> {
  const rows = await ctx.sql`select "Id" from "Devices" where "DeviceCode" in (${CODE_A}, ${CODE_B})`;
  for (const row of rows) {
    await ctx.sql`delete from "TalkSessions" where "DeviceId" = ${row.Id}`;
    await ctx.sql`delete from "StreamingSessions" where "DeviceId" = ${row.Id}`;
    await ctx.sql`delete from "Devices" where "Id" = ${row.Id}`;
  }
}

async function makeDevice(code: string): Promise<{ deviceId: bigint; liveId: bigint }> {
  const [device] = await ctx.sql`
    insert into "Devices" ("DeviceCode","VendorDeviceId","Kind","Status")
    values (${code}, ${`VENDOR-${code}`}, 1, 1) returning "Id"`;
  const [live] = await ctx.sql`
    insert into "StreamingSessions" ("DeviceId","UserId","SessionToken","SessionType","Status")
    values (${device.Id}, ${userId}, ${`tok-${code}`}, 1, 2) returning "Id"`;
  return { deviceId: device.Id as bigint, liveId: live.Id as bigint };
}

beforeAll(async () => {
  ctx = await bootHttpContext();
  const ids = await createTestUsers(ctx.sql, [{ username: `${PREFIX}u`, role: 'OPERATOR' }], await hashPassword('Test@12345'));
  userId = ids.get(`${PREFIX}u`) as bigint;
  await removeDevices();
  ({ deviceId: deviceA, liveId: liveA } = await makeDevice(CODE_A));
  ({ deviceId: deviceB, liveId: liveB } = await makeDevice(CODE_B));
});

afterEach(async () => {
  await ctx.sql`delete from "TalkSessions" where "DeviceId" in (${deviceA}, ${deviceB})`;
});

afterAll(async () => {
  if (!ctx) return;
  await removeDevices();
  await dropTestUsers(ctx.sql, [`${PREFIX}%`]);
  await ctx.close();
});

const insertTalk = (o: { deviceId: bigint; userId: bigint; liveId: bigint; status: number; ticketHash?: string | null }) => ctx.sql`
  insert into "TalkSessions" ("DeviceId","UserId","StreamingSessionId","Status","TicketHash")
  values (${o.deviceId}, ${o.userId}, ${o.liveId}, ${o.status}, ${o.ticketHash ?? null})
  returning *`;

async function violatedConstraint(query: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await query;
    return undefined;
  } catch (error) {
    return (error as { constraint_name?: string }).constraint_name;
  }
}

describe('TalkSessions table', () => {
  it('defaults: Status 1 REQUESTED, RequestedAt / CreatedAt = now(), no audio format yet', async () => {
    const [row] = await ctx.sql`
      insert into "TalkSessions" ("DeviceId","UserId","StreamingSessionId")
      values (${deviceA}, ${userId}, ${liveA}) returning *`;
    expect(row.Status).toBe(1);
    expect(row.RequestedAt).toBeInstanceOf(Date);
    expect(row.CreatedAt).toBeInstanceOf(Date);
    expect(row.EndReason).toBeNull();
    expect(row.UplinkSampleRate).toBeNull();
    expect(row.FrameMs).toBeNull();
  });

  it('1 open call per device (UX_Talk_Device_Open)', async () => {
    await insertTalk({ deviceId: deviceA, userId, liveId: liveA, status: 1 });
    expect(await violatedConstraint(insertTalk({ deviceId: deviceA, userId, liveId: liveA, status: 2 }))).toBe('UX_Talk_Device_Open');
  });

  it('ended / failed rows do not block a new call', async () => {
    const base = { deviceId: deviceA, userId, liveId: liveA };
    await insertTalk({ ...base, status: 3 });
    await insertTalk({ ...base, status: 4 });
    await insertTalk({ ...base, status: 3 });
    const [open] = await insertTalk({ ...base, status: 2 });
    expect(open.Status).toBe(2);
  });

  it('TicketHash is unique (UX_Talk_Ticket) but many NULLs are fine', async () => {
    const base = { deviceId: deviceA, userId, liveId: liveA };
    const hash = 'a'.repeat(64);
    await insertTalk({ ...base, status: 3, ticketHash: hash });
    expect(await violatedConstraint(insertTalk({ ...base, status: 4, ticketHash: hash }))).toBe('UX_Talk_Ticket');
    await insertTalk({ ...base, status: 3 });
    await insertTalk({ ...base, status: 4 });
  });

  it('FK: a missing live session is rejected', async () => {
    await expect(
      ctx.sql`insert into "TalkSessions" ("DeviceId","UserId","StreamingSessionId") values (${deviceA}, ${userId}, ${-1n})`,
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('1 open call per user (UX_Talk_User_Open): a second REQUESTED/ACTIVE row for the same user on another device fails', async () => {
    await insertTalk({ deviceId: deviceA, userId, liveId: liveA, status: 2 });
    await expect(insertTalk({ deviceId: deviceB, userId, liveId: liveB, status: 1 })).rejects.toThrow(/UX_Talk_User_Open/);
  });

  it('an ended call does not block the same user', async () => {
    await insertTalk({ deviceId: deviceA, userId, liveId: liveA, status: 3 });
    await expect(insertTalk({ deviceId: deviceB, userId, liveId: liveB, status: 1 })).resolves.toBeDefined();
  });
});

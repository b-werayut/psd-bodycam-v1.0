import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DRIZZLE } from '../../../db/db.constants';
import type { DrizzleDB } from '../../../db/db.types';
import { bootHttpContext, createTestUsers, dropTestUsers, resetDevices, type HttpContext } from '../../../test/int-helpers';
import type { InboundEnvelopeV1, InboundJobV1 } from '../inbound/inbound-body';
import { mapV1, type BookingJobSnapshot } from '../mapper/mapper-v1';
import { BookingProjectionService } from './booking-projection.service';
import { moveLeader, upsertTeamByRef } from './booking-teams';

// Design §4.5 (projection + version guard + MappingIssues) and §4.6 (teams + leader, Q55).

const PREFIX = 't6p_';
const REF_A = 'T6P-EMP-A';
const REF_B = 'T6P-EMP-B';

let ctx: HttpContext;
let db: DrizzleDB;
let projection: BookingProjectionService;
let userA: bigint;
let userB: bigint;

const snap = (job: Partial<InboundJobV1> & { jobId: string }): BookingJobSnapshot =>
  mapV1({ job: { status: 'NEW', ...job } } as InboundEnvelopeV1);
const apply = (s: BookingJobSnapshot) => db.transaction((tx) => projection.apply(tx, s));
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const jobRow = async (externalJobId: string) => {
  const [row] = await ctx.sql`
    select *, "ScheduledDate"::text as "ScheduledDateText" from "BookingJobs"
    where "SourceSystem" = 'BOOKING' and "ExternalJobId" = ${externalJobId}`;
  return row;
};
const teamByRef = (ref: string) => ctx.sql`select * from "Teams" where "BookingTeamRef" = ${ref}`;
const members = (teamId: bigint) => ctx.sql`select * from "TeamMembers" where "TeamId" = ${teamId} order by "Id"`;
const activeLeader = async (teamId: bigint) => {
  const rows = await ctx.sql`
    select "UserId" from "TeamMembers" where "TeamId" = ${teamId} and "Role" = 1 and "ValidTo" is null`;
  return rows.map((r) => r.UserId as bigint);
};

const cleanup = async () => {
  await ctx.sql`delete from "BookingJobs" where "ExternalJobId" like 'T6P-%'`;
  await ctx.sql`delete from "TeamMembers" where "TeamId" in (select "Id" from "Teams" where "Code" like 'T6P-%')`;
  if (userA !== undefined) await ctx.sql`delete from "TeamMembers" where "UserId" in (${userA}, ${userB})`;
  await ctx.sql`delete from "Teams" where "Code" like 'T6P-%'`;
};

beforeAll(async () => {
  ctx = await bootHttpContext();
  db = ctx.app.get<DrizzleDB>(DRIZZLE);
  projection = new BookingProjectionService();
  await cleanup();
  const ids = await createTestUsers(
    ctx.sql,
    [
      { username: `${PREFIX}a`, role: 'TEAM_LEADER' },
      { username: `${PREFIX}b`, role: 'TEAM_LEADER' },
    ],
    'x',
  );
  userA = ids.get(`${PREFIX}a`)!;
  userB = ids.get(`${PREFIX}b`)!;
  await ctx.sql`update "Users" set "BookingEmployeeRef" = ${REF_A} where "Id" = ${userA}`;
  await ctx.sql`update "Users" set "BookingEmployeeRef" = ${REF_B} where "Id" = ${userB}`;
});

beforeEach(async () => {
  await cleanup();
  await resetDevices(ctx.sql);
  await ctx.sql`
    insert into "Devices" ("DeviceCode", "VendorDeviceId", "Kind")
    values ('BWC-0009', '1000027', 1), ('BWC-0010', '1000028', 1)`;
});

afterAll(async () => {
  await cleanup();
  await resetDevices(ctx.sql);
  await dropTestUsers(ctx.sql, [`${PREFIX}%`]);
  await ctx.close();
});

describe('BookingProjectionService.apply', () => {
  it('a new job inserts BookingJobs with DoNo/ShNo/DeviceRefs and PayloadHash', async () => {
    const s = snap({
      jobId: 'T6P-1',
      version: 1,
      jobNo: 'JN-1',
      doNo: 'DO-1',
      shNo: 'SH-1',
      title: 'ติดตั้งกล้อง',
      deviceRefs: ['BWC-0009', 'BWC-0009', '1000028'],
      scheduledDate: '2026-11-25',
      plannedStartAt: '2026-11-25T01:00:00Z',
      plannedEndAt: '2026-11-25T05:00:00Z',
      site: { name: 'อาคาร B', address: 'ถนน 1', lat: 13.7, lng: 100.5 },
    });
    const r = await apply(s);
    expect(r).toMatchObject({ kind: 'applied', teamId: null, leaderUserId: null, previous: null });

    const row = await jobRow('T6P-1');
    expect(r.kind === 'applied' && r.bookingJobId).toBe(row.Id);
    expect(row).toMatchObject({
      ExternalJobNo: 'JN-1',
      DoNo: 'DO-1',
      ShNo: 'SH-1',
      ExternalVersion: '1',
      ExternalUpdatedAt: null,
      Status: 1,
      RawStatus: 'NEW',
      Title: 'ติดตั้งกล้อง',
      BookingTeamRef: null,
      TeamId: null,
      BookingLeaderRef: null,
      LeaderUserId: null,
      ScheduledDateText: '2026-11-25',
      PlannedStartAt: new Date('2026-11-25T01:00:00Z'),
      PlannedEndAt: new Date('2026-11-25T05:00:00Z'),
      BookingCheckInAt: null,
      BookingCheckOutAt: null,
      DeviceRefs: ['BWC-0009', '1000028'],
      SiteName: 'อาคาร B',
      SiteAddress: 'ถนน 1',
      SiteLat: 13.7,
      SiteLng: 100.5,
      PayloadHash: s.payloadHash,
      MappingIssues: null,
      SourceMissingSince: null,
    });
    expect(row.Raw).toMatchObject({ job: { jobId: 'T6P-1', doNo: 'DO-1' } });

    // the next message returns what the row held before it (the writer compares plan times / cameras)
    const next = await apply(snap({ jobId: 'T6P-1', version: 2, plannedStartAt: '2026-11-25T02:00:00Z', deviceRefs: ['1000028'] }));
    expect(next).toMatchObject({
      kind: 'applied',
      previous: {
        plannedStartAt: new Date('2026-11-25T01:00:00Z'),
        plannedEndAt: new Date('2026-11-25T05:00:00Z'),
        deviceRefs: ['BWC-0009', '1000028'],
      },
    });
    const third = await apply(snap({ jobId: 'T6P-1', version: 3 }));
    expect(third).toMatchObject({
      previous: { plannedStartAt: new Date('2026-11-25T02:00:00Z'), plannedEndAt: null, deviceRefs: ['1000028'] },
    });
    expect(await apply(snap({ jobId: 'T6P-1', version: 4 }))).toMatchObject({
      previous: { plannedStartAt: null, plannedEndAt: null, deviceRefs: [] },
    });
  });

  it('an older version is ignored and changes nothing (team, leader included)', async () => {
    const first = await apply(
      snap({ jobId: 'T6P-2', version: 10, status: 'IN_PROGRESS', teamRef: 'T6P-TEAM-A', leaderRef: REF_A, checkInAt: hoursAgo(2) }),
    );
    expect(first).toMatchObject({ kind: 'applied', leaderUserId: userA });
    const [team] = await teamByRef('T6P-TEAM-A');
    const before = await jobRow('T6P-2');

    // '9' > '10' as text — the guard must compare numbers
    const r = await apply(
      snap({ jobId: 'T6P-2', version: 9, status: 'DONE', doNo: 'DO-OLD', teamRef: 'T6P-TEAM-B', leaderRef: REF_B, checkInAt: hoursAgo(1) }),
    );
    expect(r).toEqual({ kind: 'ignored' });

    expect(await jobRow('T6P-2')).toEqual(before);
    expect(await teamByRef('T6P-TEAM-B')).toHaveLength(0);
    expect(await activeLeader(team.Id as bigint)).toEqual([userA]);
    expect(await ctx.sql`select 1 from "TeamMembers" where "UserId" = ${userB}`).toHaveLength(0);
  });

  it('updatedAt wins over version when both exist', async () => {
    await apply(snap({ jobId: 'T6P-3', version: 5, updatedAt: '2026-11-25T03:00:00Z', status: 'NEW' }));

    const newerVersionOlderTime = snap({ jobId: 'T6P-3', version: 6, updatedAt: '2026-11-25T02:00:00Z', status: 'ASSIGNED' });
    expect(await apply(newerVersionOlderTime)).toEqual({ kind: 'ignored' });
    expect(await jobRow('T6P-3')).toMatchObject({ Status: 1, ExternalVersion: '5' });

    // 04:00+07:00 = 21:00Z the day before: older, whatever the clock text says
    const olderWithOffset = snap({ jobId: 'T6P-3', version: 7, updatedAt: '2026-11-25T04:00:00+07:00', status: 'ASSIGNED' });
    expect(await apply(olderWithOffset)).toEqual({ kind: 'ignored' });

    // a lower version but a newer updatedAt is applied
    const later = snap({ jobId: 'T6P-3', version: 4, updatedAt: '2026-11-25T04:00:00Z', status: 'CANCELLED' });
    expect(await apply(later)).toMatchObject({ kind: 'applied' });
    expect(await jobRow('T6P-3')).toMatchObject({
      Status: 5,
      ExternalVersion: '4',
      ExternalUpdatedAt: new Date('2026-11-25T04:00:00Z'),
    });

    // the same message again is applied again (idempotent, not "older")
    expect(await apply(later)).toMatchObject({ kind: 'applied' });
  });

  it('the same updatedAt falls back to the version: an older version with the same stamp is ignored', async () => {
    // Booking may stamp per second: two versions of one job can carry the same updatedAt
    const at = '2026-11-25T03:00:00Z';
    const v4 = snap({ jobId: 'T6P-30', version: 4, updatedAt: at, status: 'ASSIGNED', doNo: 'DO-V4' });
    expect(await apply(v4)).toMatchObject({ kind: 'applied' });
    const before = await jobRow('T6P-30');
    expect(before).toMatchObject({ ExternalVersion: '4', DoNo: 'DO-V4' });

    const v3 = snap({ jobId: 'T6P-30', version: 3, updatedAt: at, status: 'NEW', doNo: 'DO-V3' });
    expect(await apply(v3)).toEqual({ kind: 'ignored' });
    expect(await jobRow('T6P-30')).toEqual(before);

    // same stamp, same version: the same message reprocessed is applied again (idempotent)
    expect(await apply(v4)).toMatchObject({ kind: 'applied' });
    expect(await jobRow('T6P-30')).toMatchObject({ ExternalVersion: '4', DoNo: 'DO-V4' });

    // same stamp, newer version: applied
    expect(await apply(snap({ jobId: 'T6P-30', version: 5, updatedAt: at, status: 'CANCELLED' }))).toMatchObject({
      kind: 'applied',
    });
    expect(await jobRow('T6P-30')).toMatchObject({ Status: 5, ExternalVersion: '5' });

    // updatedAt missing on one side: the version decides too
    expect(await apply(snap({ jobId: 'T6P-30', version: 4, status: 'NEW' }))).toEqual({ kind: 'ignored' });
    expect(await apply(snap({ jobId: 'T6P-30', version: 6, status: 'NEW' }))).toMatchObject({ kind: 'applied' });
    expect(await jobRow('T6P-30')).toMatchObject({ Status: 1, ExternalVersion: '6', ExternalUpdatedAt: null });
  });

  it('a new teamRef creates one team; sending again creates none', async () => {
    const r1 = await apply(snap({ jobId: 'T6P-4', version: 1, teamRef: 'T6P-TEAM-C' }));
    const r2 = await apply(snap({ jobId: 'T6P-5', version: 1, teamRef: 'T6P-TEAM-C' }));
    const r3 = await apply(snap({ jobId: 'T6P-4', version: 2, teamRef: 'T6P-TEAM-C' }));
    const none = await apply(snap({ jobId: 'T6P-6', version: 1 }));

    const teams = await teamByRef('T6P-TEAM-C');
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ Code: 'T6P-TEAM-C', Name: 'T6P-TEAM-C', IsActive: true, IsDeleted: false });
    for (const r of [r1, r2, r3]) expect(r).toMatchObject({ kind: 'applied', teamId: teams[0].Id });
    expect(none).toMatchObject({ kind: 'applied', teamId: null });
    expect(await jobRow('T6P-4')).toMatchObject({ TeamId: teams[0].Id, BookingTeamRef: 'T6P-TEAM-C' });
    expect(await jobRow('T6P-5')).toMatchObject({ TeamId: teams[0].Id });
    // no leaderRef ⇒ no leader row
    expect(await members(teams[0].Id as bigint)).toHaveLength(0);
  });

  it('checked-in job with a new leaderRef closes the old leader and opens the new one', async () => {
    // B is an active member of another team: that membership must close first (UQ_TeamMembers_ActiveUser)
    const [other] = await ctx.sql`
      insert into "Teams" ("Code", "Name", "BookingTeamRef") values ('T6P-TEAM-X', 'X', 'T6P-TEAM-X') returning "Id"`;
    await ctx.sql`
      insert into "TeamMembers" ("TeamId", "UserId", "Role", "ValidFrom")
      values (${other.Id}, ${userB}, 2, now() - interval '1 day')`;

    const r1 = await apply(
      snap({ jobId: 'T6P-7', version: 1, status: 'IN_PROGRESS', teamRef: 'T6P-TEAM-D', leaderRef: REF_A, checkInAt: hoursAgo(2) }),
    );
    expect(r1).toMatchObject({ kind: 'applied', leaderUserId: userA });
    const teamId = r1.kind === 'applied' ? r1.teamId! : 0n;
    expect(await activeLeader(teamId)).toEqual([userA]);

    const r2 = await apply(
      snap({ jobId: 'T6P-8', version: 1, status: 'IN_PROGRESS', teamRef: 'T6P-TEAM-D', leaderRef: REF_B, checkInAt: hoursAgo(1) }),
    );
    expect(r2).toMatchObject({ kind: 'applied', teamId, leaderUserId: userB });

    const rows = await members(teamId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ UserId: userA, Role: 1, AssignedBy: null });
    expect(rows[1]).toMatchObject({ UserId: userB, Role: 1, ValidTo: null, AssignedBy: null });
    expect(rows[0].ValidTo).toEqual(rows[1].ValidFrom);
    expect(await activeLeader(teamId)).toEqual([userB]);

    const [oldMembership] = await ctx.sql`select "ValidTo" from "TeamMembers" where "TeamId" = ${other.Id}`;
    expect(oldMembership.ValidTo).toEqual(rows[1].ValidFrom);

    // B already leads the team: nothing moves
    await apply(snap({ jobId: 'T6P-8', version: 2, status: 'ON_SITE', teamRef: 'T6P-TEAM-D', leaderRef: REF_B, checkInAt: hoursAgo(1) }));
    expect(await members(teamId)).toHaveLength(2);
  });

  it('a Planned, Closed or Cancelled job with another leaderRef leaves the team leader alone but sets LeaderUserId on the job', async () => {
    const r = await apply(
      snap({ jobId: 'T6P-9', version: 1, status: 'IN_PROGRESS', teamRef: 'T6P-TEAM-E', leaderRef: REF_A, checkInAt: hoursAgo(5) }),
    );
    const teamId = r.kind === 'applied' ? r.teamId! : 0n;

    const others = [
      snap({ jobId: 'T6P-10', version: 1, status: 'IN_PROGRESS', teamRef: 'T6P-TEAM-E', leaderRef: REF_B }), // Planned: no check-in
      snap({ jobId: 'T6P-11', version: 1, teamRef: 'T6P-TEAM-E', leaderRef: REF_B, checkInAt: hoursAgo(3), checkOutAt: hoursAgo(1) }),
      snap({ jobId: 'T6P-12', version: 1, status: 'COMPLETED', teamRef: 'T6P-TEAM-E', leaderRef: REF_B, checkInAt: hoursAgo(1) }),
      snap({ jobId: 'T6P-13', version: 1, status: 'CANCELLED', teamRef: 'T6P-TEAM-E', leaderRef: REF_B, checkInAt: hoursAgo(1) }),
    ];
    for (const s of others) {
      expect(await apply(s)).toMatchObject({ kind: 'applied', teamId, leaderUserId: userB });
      expect(await jobRow(s.externalJobId)).toMatchObject({ LeaderUserId: userB, BookingLeaderRef: REF_B, TeamId: teamId });
    }

    expect(await activeLeader(teamId)).toEqual([userA]);
    expect(await members(teamId)).toHaveLength(1);
    expect(await ctx.sql`select 1 from "TeamMembers" where "UserId" = ${userB}`).toHaveLength(0);
  });

  it('unknown leaderRef ⇒ MappingIssues 2; unknown status ⇒ 3; unknown camera ⇒ 5', async () => {
    const r = await apply(snap({ jobId: 'T6P-14', version: 1, leaderRef: 'T6P-NOBODY', teamRef: 'T6P-TEAM-F', checkInAt: hoursAgo(1) }));
    expect(r).toMatchObject({ kind: 'applied', leaderUserId: null });
    expect(await jobRow('T6P-14')).toMatchObject({ MappingIssues: [2], LeaderUserId: null, BookingLeaderRef: 'T6P-NOBODY' });
    expect(await members(r.kind === 'applied' ? r.teamId! : 0n)).toHaveLength(0);

    await apply(snap({ jobId: 'T6P-15', version: 1, status: 'WEIRD' }));
    expect(await jobRow('T6P-15')).toMatchObject({ MappingIssues: [3], Status: 9, RawStatus: 'WEIRD' });

    await apply(snap({ jobId: 'T6P-16', version: 1, deviceRefs: ['BWC-0009', 'NOPE-1'] }));
    expect(await jobRow('T6P-16')).toMatchObject({ MappingIssues: [5] });

    await apply(snap({ jobId: 'T6P-17', version: 1, status: 'weird', leaderRef: 'T6P-NOBODY', deviceRefs: ['NOPE-2'] }));
    expect(await jobRow('T6P-17')).toMatchObject({ MappingIssues: [2, 3, 5] });

    // recomputed every time: the camera is known now (case and spaces ignored), the issue is gone
    await apply(snap({ jobId: 'T6P-16', version: 2, deviceRefs: [' bwc-0009 ', '1000028'] }));
    expect(await jobRow('T6P-16')).toMatchObject({ MappingIssues: null, DeviceRefs: ['bwc-0009', '1000028'] });
  });
});

describe('concurrent messages of one team', () => {
  it('two new checked-in jobs of one existing team applied at once both succeed, with one active leader', async () => {
    const teamId = await db.transaction((tx) => upsertTeamByRef(tx, 'T6P-TEAM-H'));
    const jobs = [
      snap({ jobId: 'T6P-20', version: 1, status: 'IN_PROGRESS', teamRef: 'T6P-TEAM-H', leaderRef: REF_A, checkInAt: hoursAgo(1) }),
      snap({ jobId: 'T6P-21', version: 1, status: 'IN_PROGRESS', teamRef: 'T6P-TEAM-H', leaderRef: REF_B, checkInAt: hoursAgo(1) }),
    ];

    // Each transaction first holds FOR KEY SHARE on the team — the lock the other one's BookingJobs insert
    // takes through the TeamId FK — so both reach the leader move while the other still holds it.
    let ready = 0;
    let go!: () => void;
    const gate = new Promise<void>((resolve) => (go = resolve));
    // allSettled: a failed one must not leave the other transaction running into the next test
    const settled = await Promise.allSettled(
      jobs.map((s) =>
        db.transaction(async (tx) => {
          await tx.execute(sql`select 1 from "Teams" where "Id" = ${teamId.toString()}::bigint for key share`);
          if (++ready === jobs.length) go();
          await gate;
          return projection.apply(tx, s);
        }),
      ),
    );

    for (const r of settled) expect(r).toMatchObject({ status: 'fulfilled', value: { kind: 'applied', teamId } });
    const leaders = await activeLeader(teamId);
    expect(leaders).toHaveLength(1);
    expect([userA, userB]).toContain(leaders[0]);
    expect(await members(teamId)).toHaveLength(2);
  });
});

describe('moveLeader', () => {
  it('a move whose transaction began before another move committed still closes that row', async () => {
    const teamId = await db.transaction((tx) => upsertTeamByRef(tx, 'T6P-TEAM-G'));
    let began!: () => void;
    let go!: () => void;
    const started = new Promise<void>((resolve) => (began = resolve));
    const gate = new Promise<void>((resolve) => (go = resolve));

    // this transaction's now() is fixed before A's row exists; closing A's row at that now() would break
    // CK_TeamMembers_Window (ValidTo > ValidFrom)
    const late = db.transaction(async (tx) => {
      await tx.execute(sql`select now()`);
      began();
      await gate;
      return moveLeader(tx, teamId, userB);
    });
    await started;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await db.transaction((tx) => moveLeader(tx, teamId, userA))).toBe(true);
    go();

    expect(await late).toBe(true);
    expect(await activeLeader(teamId)).toEqual([userB]);
    const rows = await members(teamId);
    expect(rows.map((r) => r.UserId)).toEqual([userA, userB]);
    expect(rows[0].ValidTo).toEqual(rows[1].ValidFrom);
  });
});

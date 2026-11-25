import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { bootHttpContext, createTestUsers, dropTestUsers, type HttpContext } from '../../test/int-helpers';
import { WorkOrderWriter, type WorkOrderUpsertInput } from './work-order-writer.service';

// Design §4.7: 1:1 upsert, numbering per Bangkok month, events, NeedsReview reason 1, LastActivityAt untouched.

let ctx: HttpContext;
let db: DrizzleDB;
let writer: WorkOrderWriter;
let team1: bigint;
let team2: bigint;
let leader1: bigint;
let leader2: bigint;

const NOW = new Date('2099-03-15T00:00:00Z');
const CHECK_IN = new Date('2099-03-15T02:00:00Z');
const CHECK_OUT = new Date('2099-03-15T06:00:00Z');

const insertJob = async (externalJobId: string) => {
  const [row] = await ctx.sql`
    insert into "BookingJobs" ("ExternalJobId", "Status", "Raw", "PayloadHash")
    values (${externalJobId}, 1, '{}'::jsonb, ${'a'.repeat(64)})
    returning "Id"`;
  return row.Id as bigint;
};

const job = (over: Partial<WorkOrderUpsertInput['job']> = {}): WorkOrderUpsertInput['job'] => ({
  status: 1,
  checkInAt: null,
  checkOutAt: null,
  plannedStartAt: null,
  plannedEndAt: null,
  deviceRefs: [],
  ...over,
});
const input = (bookingJobId: bigint, over: Partial<WorkOrderUpsertInput> = {}): WorkOrderUpsertInput => ({
  bookingJobId,
  title: 'ติดตั้งกล้อง',
  teamId: null,
  leaderUserId: null,
  job: job(),
  previous: null,
  now: NOW,
  ...over,
});
const closedJob = (over: Partial<WorkOrderUpsertInput['job']> = {}) =>
  job({ status: 4, checkInAt: CHECK_IN, checkOutAt: CHECK_OUT, ...over });
const upsert = (i: WorkOrderUpsertInput) => db.transaction((tx) => writer.upsertFromBooking(tx, i));

const woOf = async (bookingJobId: bigint) => {
  const [row] = await ctx.sql`select * from "WorkOrders" where "BookingJobId" = ${bookingJobId}`;
  return row;
};
const eventsOf = (workOrderId: bigint) =>
  ctx.sql`select * from "WorkOrderEvents" where "WorkOrderId" = ${workOrderId} order by "Id"`;

const cleanup = async () => {
  await ctx.sql`
    delete from "WorkOrderEvents" where "WorkOrderId" in (
      select w."Id" from "WorkOrders" w join "BookingJobs" b on b."Id" = w."BookingJobId" where b."ExternalJobId" like 'T6W-%')`;
  await ctx.sql`
    delete from "WorkOrders" where "BookingJobId" in (select "Id" from "BookingJobs" where "ExternalJobId" like 'T6W-%')`;
  await ctx.sql`delete from "BookingJobs" where "ExternalJobId" like 'T6W-%'`;
  await ctx.sql`delete from "WorkOrderCounters" where "Period" like '2099%'`;
  await ctx.sql`delete from "Teams" where "Code" like 'T6W-%'`;
};

beforeAll(async () => {
  ctx = await bootHttpContext();
  db = ctx.app.get<DrizzleDB>(DRIZZLE);
  writer = new WorkOrderWriter();
  await cleanup();
  const users = await createTestUsers(
    ctx.sql,
    [
      { username: 't6w_leader1', role: 'TEAM_LEADER' },
      { username: 't6w_leader2', role: 'TEAM_LEADER' },
    ],
    'x',
  );
  leader1 = users.get('t6w_leader1')!;
  leader2 = users.get('t6w_leader2')!;
});

beforeEach(async () => {
  await cleanup();
  const teams = await ctx.sql`
    insert into "Teams" ("Code", "Name", "BookingTeamRef")
    values ('T6W-TEAM-1', 'T6W-TEAM-1', 'T6W-TEAM-1'), ('T6W-TEAM-2', 'T6W-TEAM-2', 'T6W-TEAM-2')
    returning "Id"`;
  team1 = teams[0].Id as bigint;
  team2 = teams[1].Id as bigint;
});

afterAll(async () => {
  await cleanup();
  await dropTestUsers(ctx.sql, ['t6w_%']);
  await ctx.close();
});

describe('WorkOrderWriter.upsertFromBooking', () => {
  it('creates WO-YYYYMM-00001 then 00002 in the same Bangkok month', async () => {
    const j1 = await insertJob('T6W-1');
    const j2 = await insertJob('T6W-2');
    // 1 Mar 00:00 in Bangkok is still 28 Feb in UTC; 31 Mar 23:59 in Bangkok is still March
    const c1 = await upsert(input(j1, { now: new Date('2099-03-01T00:00:00+07:00'), teamId: team1 }));
    const c2 = await upsert(input(j2, { now: new Date('2099-03-31T23:59:00+07:00') }));

    expect(c1).toMatchObject({ status: 6, needsReview: false, rowVersion: 1, teamId: team1, change: 'created' });
    expect(c2).toMatchObject({ status: 6, change: 'created', teamId: null });

    const wo1 = await woOf(j1);
    const wo2 = await woOf(j2);
    expect(c1?.workOrderId).toBe(wo1.Id);
    expect(wo1).toMatchObject({
      WorkOrderNo: 'WO-209903-00001',
      Title: 'ติดตั้งกล้อง',
      Status: 6,
      CloseReason: null,
      TeamId: team1,
      LeaderUserId: null,
      OpenedAt: null,
      ClosedAt: null,
      LastActivityAt: null,
      NeedsReview: false,
      ReviewReasons: null,
      RowVersion: 1,
    });
    expect(wo2.WorkOrderNo).toBe('WO-209903-00002');

    const events = await eventsOf(wo1.Id as bigint);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      EventType: 1,
      FromStatus: null,
      ToStatus: 6,
      Source: 2,
      BookingJobId: j1,
      ActorUserId: null,
      Detail: null,
    });
  });

  it('20 jobs upserted concurrently get 20 distinct numbers', async () => {
    const jobs: bigint[] = [];
    for (let i = 0; i < 20; i++) jobs.push(await insertJob(`T6W-C${i}`));
    const now = new Date('2099-04-10T00:00:00Z');

    const changes = await Promise.all(jobs.map((id) => upsert(input(id, { now }))));
    expect(changes.every((c) => c?.change === 'created')).toBe(true);

    const rows = await ctx.sql`select "WorkOrderNo" from "WorkOrders" where "BookingJobId" in ${ctx.sql(jobs)} order by "WorkOrderNo"`;
    const expected = Array.from({ length: 20 }, (_, i) => `WO-209904-${String(i + 1).padStart(5, '0')}`);
    expect(rows.map((r) => r.WorkOrderNo)).toEqual(expected);
  });

  it('status change writes a StatusChanged event with From/To', async () => {
    const j = await insertJob('T6W-3');
    await upsert(input(j));

    const open = await upsert(input(j, { job: job({ status: 3, checkInAt: CHECK_IN }) }));
    expect(open).toMatchObject({ status: 1, needsReview: false, rowVersion: 2, change: 'statusChanged' });
    expect(await woOf(j)).toMatchObject({ Status: 1, OpenedAt: CHECK_IN, ClosedAt: null, CloseReason: null, RowVersion: 2 });

    const closed = await upsert(input(j, { job: job({ status: 4, checkInAt: CHECK_IN, checkOutAt: CHECK_OUT }) }));
    expect(closed).toMatchObject({ status: 2, rowVersion: 3, change: 'statusChanged' });
    const wo = await woOf(j);
    expect(wo).toMatchObject({ Status: 2, CloseReason: 1, OpenedAt: CHECK_IN, ClosedAt: CHECK_OUT, LastActivityAt: null });

    const events = await eventsOf(wo.Id as bigint);
    expect(events.map((e) => [e.EventType, e.FromStatus, e.ToStatus, e.Source, e.BookingJobId, e.Detail])).toEqual([
      [1, null, 6, 2, j, null],
      [2, 6, 1, 2, j, null],
      [2, 1, 2, 2, j, null],
    ]);
  });

  it('nothing changed ⇒ null and RowVersion unchanged', async () => {
    const j = await insertJob('T6W-4');
    const first = input(j, {
      teamId: team1,
      job: job({ status: 3, checkInAt: CHECK_IN, plannedStartAt: CHECK_IN, deviceRefs: ['BWC-0009'] }),
    });
    await upsert(first);
    const before = await woOf(j);

    expect(await upsert({ ...first, now: new Date('2099-03-16T00:00:00Z') })).toBeNull();
    expect(await woOf(j)).toEqual(before);
    expect(await eventsOf(before.Id as bigint)).toHaveLength(1);

    // a new title is an update without a status event
    const renamed = await upsert({ ...first, title: 'ชื่อใหม่' });
    expect(renamed).toMatchObject({ status: 1, rowVersion: 2, change: 'updated', needsReview: false });
    expect(await woOf(j)).toMatchObject({ Title: 'ชื่อใหม่', RowVersion: 2 });
    expect(await eventsOf(before.Id as bigint)).toHaveLength(1);
  });

  it('team change after Closed ⇒ NeedsReview with reason 1', async () => {
    const j = await insertJob('T6W-5');
    await upsert(input(j, { teamId: team1, job: closedJob() }));

    const c = await upsert(input(j, { teamId: team2, job: closedJob() }));
    expect(c).toMatchObject({ status: 2, needsReview: true, rowVersion: 2, teamId: team2, change: 'updated' });
    expect(await woOf(j)).toMatchObject({
      Status: 2,
      CloseReason: 1,
      ClosedAt: CHECK_OUT,
      TeamId: team2,
      NeedsReview: true,
      ReviewReasons: [1],
    });

    // already flagged: the same message changes nothing
    expect(await upsert(input(j, { teamId: team2, job: closedJob() }))).toBeNull();
  });

  it('leader change after Closed ⇒ NeedsReview with reason 1', async () => {
    const j = await insertJob('T6W-10');
    await upsert(input(j, { leaderUserId: leader1, job: closedJob() }));

    const c = await upsert(input(j, { leaderUserId: leader2, job: closedJob() }));
    expect(c).toMatchObject({ status: 2, needsReview: true, rowVersion: 2, change: 'updated' });
    expect(await woOf(j)).toMatchObject({ Status: 2, LeaderUserId: leader2, NeedsReview: true, ReviewReasons: [1] });
  });

  it('plan time or camera change after Closed ⇒ NeedsReview; a reopen never flags', async () => {
    const plan = new Date('2099-03-15T01:00:00Z');
    const cams = await insertJob('T6W-6');
    await upsert(input(cams, { job: closedJob({ plannedStartAt: plan, deviceRefs: ['BWC-0009'] }) }));
    const previousCams = { plannedStartAt: plan, plannedEndAt: null, deviceRefs: ['BWC-0009'] };
    expect(
      await upsert(
        input(cams, { previous: previousCams, job: closedJob({ plannedStartAt: plan, deviceRefs: ['BWC-0009', 'BWC-0010'] }) }),
      ),
    ).toMatchObject({ needsReview: true, change: 'updated' });

    const times = await insertJob('T6W-7');
    await upsert(input(times, { job: closedJob({ plannedStartAt: plan }) }));
    const previousTimes = { plannedStartAt: plan, plannedEndAt: null, deviceRefs: [] };
    expect(
      await upsert(input(times, { previous: previousTimes, job: closedJob({ plannedStartAt: plan, plannedEndAt: CHECK_OUT }) })),
    ).toMatchObject({ needsReview: true });
    expect(await woOf(times)).toMatchObject({ ReviewReasons: [1] });

    const reopen = await insertJob('T6W-8');
    await upsert(input(reopen, { teamId: team1, job: closedJob() }));
    const later = new Date('2099-03-15T08:00:00Z');
    const c = await upsert(input(reopen, { teamId: team2, job: job({ status: 3, checkInAt: later, checkOutAt: CHECK_OUT }) }));
    expect(c).toMatchObject({ status: 1, needsReview: false, change: 'statusChanged', teamId: team2 });
    expect(await woOf(reopen)).toMatchObject({ Status: 1, OpenedAt: later, ClosedAt: null, CloseReason: null, NeedsReview: false });
  });

  it('a change of camera order alone after Closed is no change', async () => {
    const j = await insertJob('T6W-11');
    await upsert(input(j, { job: closedJob({ deviceRefs: ['BWC-0009', 'BWC-0010'] }) }));
    const previous = { plannedStartAt: null, plannedEndAt: null, deviceRefs: ['BWC-0009', 'BWC-0010'] };

    expect(await upsert(input(j, { previous, job: closedJob({ deviceRefs: ['BWC-0010', 'BWC-0009'] }) }))).toBeNull();
    expect(await woOf(j)).toMatchObject({ NeedsReview: false, ReviewReasons: null, RowVersion: 1 });
  });

  it('a flagged order that reopens keeps NeedsReview', async () => {
    const j = await insertJob('T6W-12');
    await upsert(input(j, { teamId: team1, job: closedJob() }));
    expect(await upsert(input(j, { teamId: team2, job: closedJob() }))).toMatchObject({ needsReview: true });

    const later = new Date('2099-03-15T08:00:00Z');
    const c = await upsert(input(j, { teamId: team2, job: job({ status: 3, checkInAt: later, checkOutAt: CHECK_OUT }) }));
    expect(c).toMatchObject({ status: 1, needsReview: true, change: 'statusChanged' });
    expect(await woOf(j)).toMatchObject({ Status: 1, ClosedAt: null, NeedsReview: true, ReviewReasons: [1] });
  });

  it('a cancel after Closed keeps the work order Closed and flags reason 1', async () => {
    const j = await insertJob('T6W-9');
    await upsert(input(j, { job: closedJob() }));

    const c = await upsert(input(j, { job: closedJob({ status: 5 }), now: new Date('2099-03-20T00:00:00Z') }));
    expect(c).toMatchObject({ status: 2, needsReview: true, change: 'updated' });
    expect(await woOf(j)).toMatchObject({ Status: 2, CloseReason: 1, ClosedAt: CHECK_OUT, ReviewReasons: [1], LastActivityAt: null });
  });
});

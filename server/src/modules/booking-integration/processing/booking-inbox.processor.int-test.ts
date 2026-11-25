import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BOOKING_INBOX, queueConnection, queuePrefix, type BookingInboxJob } from '../../../common/queue/queue.constants';
import { DRIZZLE } from '../../../db/db.constants';
import type { DrizzleDB } from '../../../db/db.types';
import { bootHttpContext, eventually, recordingGateway, type HttpContext } from '../../../test/int-helpers';
import type { RealtimeGateway } from '../../realtime/realtime.gateway';
import { WorkOrderWriter } from '../../work-orders/work-order-writer.service';
import type { InboundJobV1 } from '../inbound/inbound-body';
import { BookingProjectionService } from '../projection/booking-projection.service';
import { BookingInboxProcessor } from './booking-inbox.processor';
import { BookingInboxWorker } from './booking-inbox.worker';

// Design §4.4 (inbox processing, Failed / Dead after 10) and §4.7 (workorder:changed after commit).

const PREFIX = 'T7P-';
const NOW = new Date('2098-07-15T00:00:00Z');
const CHECK_IN = '2098-07-15T02:00:00Z';
const CHECK_OUT = '2098-07-15T06:00:00Z';

let ctx: HttpContext;
let db: DrizzleDB;

type Emits = ReturnType<typeof recordingGateway>['emits'];

const makeProcessor = (writer: WorkOrderWriter = new WorkOrderWriter()) => {
  const recorder = recordingGateway();
  const processor = new BookingInboxProcessor(
    db,
    new BookingProjectionService(),
    writer,
    recorder.gateway as unknown as RealtimeGateway,
  );
  return { processor, emits: recorder.emits };
};

const envelope = (job: Partial<InboundJobV1> & { jobId: string }) => ({
  eventType: 'job.updated',
  job: { status: 'NEW', ...job },
});

let seq = 0;
const insertInbox = async (payload: unknown, over: { status?: number; attempts?: number } = {}) => {
  const [row] = await ctx.sql`
    insert into "IntegrationInbox" ("Source", "ExternalEventId", "EventType", "Channel", "Payload", "Status", "Attempts")
    values ('BOOKING', ${`${PREFIX}evt-${++seq}-${randomUUID()}`}, 'job.updated', 1, ${JSON.stringify(payload)}::jsonb,
            ${over.status ?? 1}, ${over.attempts ?? 0})
    returning "Id"`;
  return row.Id as bigint;
};

const inboxRow = async (id: bigint) => {
  const [row] = await ctx.sql`select * from "IntegrationInbox" where "Id" = ${id}`;
  return row;
};
const jobRows = (externalJobId: string) =>
  ctx.sql`select * from "BookingJobs" where "SourceSystem" = 'BOOKING' and "ExternalJobId" = ${externalJobId}`;
const woRows = (externalJobId: string) => ctx.sql`
  select w.* from "WorkOrders" w join "BookingJobs" b on b."Id" = w."BookingJobId"
  where b."ExternalJobId" = ${externalJobId}`;
const eventsOf = (workOrderId: bigint) =>
  ctx.sql`select * from "WorkOrderEvents" where "WorkOrderId" = ${workOrderId} order by "Id"`;
const changedEmits = (emits: Emits) => emits.filter(([, event]) => event === 'workorder:changed');

const cleanup = async () => {
  await ctx.sql`
    delete from "WorkOrderEvents" where "WorkOrderId" in (
      select w."Id" from "WorkOrders" w join "BookingJobs" b on b."Id" = w."BookingJobId" where b."ExternalJobId" like 'T7P-%')`;
  await ctx.sql`
    delete from "WorkOrders" where "BookingJobId" in (select "Id" from "BookingJobs" where "ExternalJobId" like 'T7P-%')`;
  await ctx.sql`delete from "BookingJobs" where "ExternalJobId" like 'T7P-%'`;
  await ctx.sql`delete from "IntegrationInbox" where "ExternalEventId" like 'T7P-%'`;
  await ctx.sql`delete from "TeamMembers" where "TeamId" in (select "Id" from "Teams" where "Code" like 'T7P-%')`;
  await ctx.sql`delete from "Teams" where "Code" like 'T7P-%'`;
  await ctx.sql`delete from "WorkOrderCounters" where "Period" like '2098%'`;
};

beforeAll(async () => {
  ctx = await bootHttpContext();
  db = ctx.app.get<DrizzleDB>(DRIZZLE);
});

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
  await ctx.close();
});

describe('BookingInboxProcessor.process', () => {
  it('a Pending row ⇒ processed: one BookingJobs, one Planned WO, Created event, workorder:changed after commit', async () => {
    const { processor, emits } = makeProcessor();
    const id = await insertInbox(envelope({ jobId: 'T7P-1', version: 1, jobNo: 'JN-1', doNo: 'DO-1' }));

    expect(await processor.process(id, NOW)).toBe('processed');

    expect(await inboxRow(id)).toMatchObject({ Status: 2, Attempts: 0, LastError: null });
    expect((await inboxRow(id)).ProcessedAt).toBeInstanceOf(Date);
    const jobs = await jobRows('T7P-1');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ ExternalVersion: '1', DoNo: 'DO-1', Status: 1 });
    const wos = await woRows('T7P-1');
    expect(wos).toHaveLength(1);
    expect(wos[0]).toMatchObject({ Status: 6, Title: 'JN-1', TeamId: null, RowVersion: 1, BookingJobId: jobs[0].Id });
    expect(wos[0].WorkOrderNo).toMatch(/^WO-209807-\d{5}$/);
    expect(await eventsOf(wos[0].Id)).toMatchObject([{ EventType: 1, ToStatus: 6, Source: 2, BookingJobId: jobs[0].Id }]);

    expect(emits).toEqual([
      [
        'tracking',
        'workorder:changed',
        { workOrderId: String(wos[0].Id), status: 6, needsReview: false, rowVersion: 1, change: 'created' },
      ],
    ]);
  });

  it('a job with a team ⇒ workorder:changed also goes to team:{id}', async () => {
    const { processor, emits } = makeProcessor();
    const id = await insertInbox(envelope({ jobId: 'T7P-TEAM', version: 1, teamRef: 'T7P-TEAM-A' }));

    expect(await processor.process(id, NOW)).toBe('processed');

    const [wo] = await woRows('T7P-TEAM');
    expect(wo.TeamId).not.toBeNull();
    const payload = { workOrderId: String(wo.Id), status: 6, needsReview: false, rowVersion: 1, change: 'created' };
    expect(emits).toEqual([
      ['tracking', 'workorder:changed', payload],
      [`team:${wo.TeamId}`, 'workorder:changed', payload],
    ]);
  });

  it('check-in then check-out rows ⇒ Open then Closed BookingCheckout', async () => {
    const { processor, emits } = makeProcessor();
    const checkIn = await insertInbox(envelope({ jobId: 'T7P-2', version: 1, status: 'IN_PROGRESS', checkInAt: CHECK_IN }));
    const checkOut = await insertInbox(
      envelope({ jobId: 'T7P-2', version: 2, status: 'DONE', checkInAt: CHECK_IN, checkOutAt: CHECK_OUT }),
    );

    expect(await processor.process(checkIn, NOW)).toBe('processed');
    let [wo] = await woRows('T7P-2');
    expect(wo).toMatchObject({ Status: 1, OpenedAt: new Date(CHECK_IN), ClosedAt: null, CloseReason: null });

    expect(await processor.process(checkOut, NOW)).toBe('processed');
    [wo] = await woRows('T7P-2');
    expect(wo).toMatchObject({ Status: 2, CloseReason: 1, ClosedAt: new Date(CHECK_OUT), RowVersion: 2 });
    expect(await woRows('T7P-2')).toHaveLength(1);
    expect(await eventsOf(wo.Id)).toMatchObject([
      { EventType: 1, FromStatus: null, ToStatus: 1 },
      { EventType: 2, FromStatus: 1, ToStatus: 2, Reason: 'BookingCheckout' },
    ]);
    expect(changedEmits(emits).map(([, , p]) => p)).toEqual([
      { workOrderId: String(wo.Id), status: 1, needsReview: false, rowVersion: 1, change: 'created' },
      { workOrderId: String(wo.Id), status: 2, needsReview: false, rowVersion: 2, change: 'statusChanged' },
    ]);
  });

  it('an older version row ⇒ ignored, WO unchanged', async () => {
    const { processor, emits } = makeProcessor();
    const newer = await insertInbox(envelope({ jobId: 'T7P-3', version: 2, status: 'IN_PROGRESS', checkInAt: CHECK_IN }));
    const older = await insertInbox(envelope({ jobId: 'T7P-3', version: 1, status: 'NEW', doNo: 'DO-OLD' }));

    expect(await processor.process(newer, NOW)).toBe('processed');
    const [before] = await woRows('T7P-3');
    emits.length = 0;

    expect(await processor.process(older, NOW)).toBe('ignored');

    expect(await inboxRow(older)).toMatchObject({ Status: 4, Attempts: 0 });
    expect((await inboxRow(older)).ProcessedAt).toBeInstanceOf(Date);
    const [after] = await woRows('T7P-3');
    expect(after).toMatchObject({ Status: 1, RowVersion: before.RowVersion, UpdatedAt: before.UpdatedAt });
    const [job] = await jobRows('T7P-3');
    expect(job).toMatchObject({ ExternalVersion: '2', DoNo: null });
    expect(emits).toEqual([]);
  });

  it('a newer version that changes only booking fields ⇒ workorder:changed updated with the current row', async () => {
    const { processor, emits } = makeProcessor();
    const v1 = await insertInbox(envelope({ jobId: 'T7P-4', version: 1, jobNo: 'JN-4', deviceRefs: ['CAM-1'] }));
    const v2 = await insertInbox(
      envelope({ jobId: 'T7P-4', version: 2, jobNo: 'JN-4', doNo: 'DO-4', deviceRefs: ['CAM-1', 'CAM-2'] }),
    );
    expect(await processor.process(v1, NOW)).toBe('processed');
    emits.length = 0;

    expect(await processor.process(v2, NOW)).toBe('processed');

    const [wo] = await woRows('T7P-4');
    expect(wo).toMatchObject({ Status: 6, RowVersion: 1 });
    expect((await jobRows('T7P-4'))[0]).toMatchObject({ DoNo: 'DO-4', DeviceRefs: ['CAM-1', 'CAM-2'] });
    expect(emits).toEqual([
      [
        'tracking',
        'workorder:changed',
        { workOrderId: String(wo.Id), status: 6, needsReview: false, rowVersion: 1, change: 'updated' },
      ],
    ]);
  });

  it('two versions of the same job processed at once ⇒ one WO with the newer status', async () => {
    const { processor: first } = makeProcessor();
    const { processor: second } = makeProcessor();
    const jobs = ['T7P-C1', 'T7P-C2', 'T7P-C3', 'T7P-C4'];
    const runs: Promise<string>[] = [];
    for (const [i, jobId] of jobs.entries()) {
      const v1 = await insertInbox(envelope({ jobId, version: 1, status: 'IN_PROGRESS', checkInAt: CHECK_IN }));
      const v2 = await insertInbox(
        envelope({ jobId, version: 2, status: 'DONE', checkInAt: CHECK_IN, checkOutAt: CHECK_OUT }),
      );
      // both orders: sometimes the newer version starts first
      const [a, b] = i % 2 === 0 ? [v1, v2] : [v2, v1];
      runs.push(first.process(a, NOW), second.process(b, NOW));
    }

    const outcomes = await Promise.all(runs);

    expect(outcomes.every((o) => o === 'processed' || o === 'ignored')).toBe(true);
    for (const jobId of jobs) {
      const wos = await woRows(jobId);
      expect(wos).toHaveLength(1);
      expect(wos[0]).toMatchObject({ Status: 2, CloseReason: 1, ClosedAt: new Date(CHECK_OUT) });
      expect(await jobRows(jobId)).toMatchObject([{ ExternalVersion: '2', Status: 4 }]);
    }
    const left = await ctx.sql`
      select count(*)::int as n from "IntegrationInbox" where "ExternalEventId" like 'T7P-%' and "Status" not in (2, 4)`;
    expect(left[0].n).toBe(0);
  });

  it('a row that throws ten times ⇒ Dead with LastError', async () => {
    const { processor, emits } = makeProcessor();
    // stored as received: the job has no status (an api that validated it could never store this)
    const id = await insertInbox({ job: { jobId: 'T7P-5', version: 1, title: 'SECRET-TITLE' } });

    for (let attempt = 1; attempt <= 9; attempt++) {
      expect(await processor.process(id, NOW)).toBe('failed');
      expect(await inboxRow(id)).toMatchObject({ Status: 3, Attempts: attempt, ProcessedAt: null });
    }
    expect(await processor.process(id, NOW)).toBe('dead');

    const row = await inboxRow(id);
    expect(row).toMatchObject({ Status: 5, Attempts: 10, ProcessedAt: null });
    expect(row.LastError).toMatch(/job\.status/);
    expect(row.LastError).not.toContain('SECRET-TITLE');
    expect(row.LastError.length).toBeLessThanOrEqual(1000);
    expect(await processor.process(id, NOW)).toBe('skipped');
    expect(await jobRows('T7P-5')).toHaveLength(0);
    expect(emits).toEqual([]);
  });

  it('a failure after the work order was written ⇒ everything rolled back, nothing emitted, Failed with a safe LastError', async () => {
    class FailingWriter extends WorkOrderWriter {
      override async upsertFromBooking(...args: Parameters<WorkOrderWriter['upsertFromBooking']>): Promise<null> {
        await super.upsertFromBooking(...args);
        throw Object.assign(new Error('Failed query: insert … params: SECRET-PAYLOAD'), {
          name: 'DrizzleQueryError',
          cause: new Error('deadlock detected'),
        });
      }
    }
    const { processor, emits } = makeProcessor(new FailingWriter());
    const id = await insertInbox(envelope({ jobId: 'T7P-6', version: 1, teamRef: 'T7P-TEAM-6' }));

    expect(await processor.process(id, NOW)).toBe('failed');

    expect(await inboxRow(id)).toMatchObject({
      Status: 3,
      Attempts: 1,
      LastError: 'DrizzleQueryError: deadlock detected',
      ProcessedAt: null,
    });
    expect(await jobRows('T7P-6')).toHaveLength(0);
    expect(await woRows('T7P-6')).toHaveLength(0);
    expect(await ctx.sql`select 1 from "Teams" where "Code" = 'T7P-TEAM-6'`).toHaveLength(0);
    expect(emits).toEqual([]);

    // the next attempt (a working writer) goes through
    const { processor: healthy } = makeProcessor();
    expect(await healthy.process(id, NOW)).toBe('processed');
    expect(await inboxRow(id)).toMatchObject({ Status: 2, Attempts: 1 });
    expect(await woRows('T7P-6')).toHaveLength(1);
  });

  it('a stored title longer than the column is cut like the api did, not Dead', async () => {
    const { processor } = makeProcessor();
    const id = await insertInbox(envelope({ jobId: 'T7P-7', version: 1, title: 'ก'.repeat(400) }));

    expect(await processor.process(id, NOW)).toBe('processed');
    const [wo] = await woRows('T7P-7');
    expect(wo.Title).toBe('ก'.repeat(300));
  });

  it('a row already Processed ⇒ skipped', async () => {
    const { processor, emits } = makeProcessor();
    const id = await insertInbox(envelope({ jobId: 'T7P-8', version: 1 }));
    expect(await processor.process(id, NOW)).toBe('processed');
    emits.length = 0;

    expect(await processor.process(id, NOW)).toBe('skipped');

    expect(await woRows('T7P-8')).toHaveLength(1);
    expect(await eventsOf((await woRows('T7P-8'))[0].Id)).toHaveLength(1);
    expect(emits).toEqual([]);
    const dead = await insertInbox(envelope({ jobId: 'T7P-8b', version: 1 }), { status: 5, attempts: 10 });
    expect(await processor.process(dead, NOW)).toBe('skipped');
    expect(await processor.process(99_999_999_999n, NOW)).toBe('skipped');
  });

  it('a row another worker holds ⇒ skipped without waiting', async () => {
    const { processor } = makeProcessor();
    const id = await insertInbox(envelope({ jobId: 'T7P-9', version: 1 }));

    const outcome = await ctx.sql.begin(async (tx) => {
      await tx`select 1 from "IntegrationInbox" where "Id" = ${id} for update`;
      return processor.process(id, NOW);
    });

    expect(outcome).toBe('skipped');
    expect(await inboxRow(id)).toMatchObject({ Status: 1, Attempts: 0 });
    expect(await jobRows('T7P-9')).toHaveLength(0);
  });
});

describe('BookingInboxWorker', () => {
  it('runs process(BigInt(inboxId)) for booking-inbox jobs, 4 at a time, and stops before shutdown', async () => {
    const calls: bigint[] = [];
    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stub = {
      process: async (inboxId: bigint) => {
        calls.push(inboxId);
        active++;
        maxActive = Math.max(maxActive, active);
        await gate;
        active--;
        return 'processed' as const;
      },
    } as unknown as BookingInboxProcessor;
    const connection = queueConnection(process.env.REDIS_URL!, 'producer');
    const queue = new Queue<BookingInboxJob>(BOOKING_INBOX, { connection, prefix: queuePrefix() });
    const worker = new BookingInboxWorker(stub);
    try {
      await queue.obliterate({ force: true });
      worker.onApplicationBootstrap();
      expect(worker.isRunning()).toBe(true);

      const ids = [987_654_321n, 987_654_322n, 987_654_323n, 987_654_324n, 987_654_325n, 987_654_326n];
      for (const id of ids) await queue.add(BOOKING_INBOX, { inboxId: String(id) }, { jobId: `inbox-${id}` });
      await eventually(async () => active === 4);
      release();
      await eventually(async () => ids.every((id) => calls.includes(id)));
      expect(maxActive).toBe(4);

      await worker.beforeApplicationShutdown();
      expect(worker.isRunning()).toBe(false);
      await worker.onApplicationShutdown(); // idempotent
    } finally {
      release();
      await worker.onApplicationShutdown();
      await queue.obliterate({ force: true });
      await queue.close();
      connection.disconnect();
    }
  });

  it('without REDIS_URL it does not start', async () => {
    const saved = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    try {
      const worker = new BookingInboxWorker({} as BookingInboxProcessor);
      worker.onApplicationBootstrap();
      expect(worker.isRunning()).toBe(false);
      await worker.onApplicationShutdown();
    } finally {
      process.env.REDIS_URL = saved;
    }
  });
});

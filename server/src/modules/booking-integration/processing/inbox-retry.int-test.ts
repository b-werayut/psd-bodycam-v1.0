import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DRIZZLE } from '../../../db/db.constants';
import type { DrizzleDB } from '../../../db/db.types';
import { bootHttpContext, recordingGateway, type HttpContext } from '../../../test/int-helpers';
import type { RealtimeGateway } from '../../realtime/realtime.gateway';
import { WorkOrderWriter } from '../../work-orders/work-order-writer.service';
import { BookingProjectionService } from '../projection/booking-projection.service';
import { BookingInboxProcessor } from './booking-inbox.processor';
import { InboxRetryJob } from './inbox-retry.job';

// Design §4.4: the retry sweep picks Pending (> 1 min old) and Failed rows straight from the DB.

const PREFIX = 'T8R-';
const NOW = new Date('2098-07-15T00:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let ctx: HttpContext;
let db: DrizzleDB;

const makeJob = () => {
  const processor = new BookingInboxProcessor(
    db,
    new BookingProjectionService(),
    new WorkOrderWriter(),
    recordingGateway().gateway as unknown as RealtimeGateway,
  );
  const lock = { withLock: async (_k: string, _t: number, run: () => Promise<unknown>) => run() };
  return new InboxRetryJob(db, processor, lock as never, null);
};

let seq = 0;
const insertInbox = async (jobId: string, receivedAt: Date, status = 1) => {
  const [row] = await ctx.sql`
    insert into "IntegrationInbox" ("Source", "ExternalEventId", "EventType", "Channel", "Payload", "Status", "ReceivedAt")
    values ('BOOKING', ${`${PREFIX}evt-${++seq}-${randomUUID()}`}, 'job.updated', 1,
            ${JSON.stringify({ eventType: 'job.updated', job: { jobId, status: 'NEW', version: 1 } })}::jsonb,
            ${status}, ${receivedAt})
    returning "Id"`;
  return row.Id as bigint;
};
const statusOf = async (id: bigint) => (await ctx.sql`select "Status" from "IntegrationInbox" where "Id" = ${id}`)[0].Status;
const woCount = async (jobId: string) =>
  (
    await ctx.sql`select w."Id" from "WorkOrders" w join "BookingJobs" b on b."Id" = w."BookingJobId" where b."ExternalJobId" = ${jobId}`
  ).length;

// The sweep is global: rows other suites leave behind (e.g. the inbound endpoint test) would be processed too,
// so every BOOKING inbox row and the job / WO it may have produced ('J-1') is removed with ours.
const OURS = `(b."ExternalJobId" like 'T8R-%' or b."ExternalJobId" = 'J-1')`;
const cleanup = async () => {
  await ctx.sql`delete from "IntegrationInbox" where "Source" = 'BOOKING'`;
  await ctx.sql`delete from "WorkOrderEvents" where "WorkOrderId" in (
    select w."Id" from "WorkOrders" w join "BookingJobs" b on b."Id" = w."BookingJobId" where ${ctx.sql.unsafe(OURS)})`;
  await ctx.sql`delete from "WorkOrders" where "BookingJobId" in (
    select b."Id" from "BookingJobs" b where ${ctx.sql.unsafe(OURS)})`;
  await ctx.sql`delete from "BookingJobs" b where ${ctx.sql.unsafe(OURS)}`;
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

describe('InboxRetryJob.runOnce', () => {
  it('a Pending row older than 1 minute is processed; a newer one is left', async () => {
    const old = await insertInbox('T8R-OLD', ago(2 * 60_000));
    const fresh = await insertInbox('T8R-NEW', ago(10_000));

    expect(await makeJob().runOnce(NOW)).toBe(1);

    expect(await statusOf(old)).toBe(2);
    expect(await statusOf(fresh)).toBe(1);
    expect(await woCount('T8R-OLD')).toBe(1);
    expect(await woCount('T8R-NEW')).toBe(0);
  });

  it('Failed rows are retried', async () => {
    const id = await insertInbox('T8R-FAILED', ago(10_000), 3);

    expect(await makeJob().runOnce(NOW)).toBe(1);

    expect(await statusOf(id)).toBe(2);
    expect(await woCount('T8R-FAILED')).toBe(1);
  });

  it('a row left Pending by a dead worker (no lock held) produces exactly one WO after two sweeps', async () => {
    const id = await insertInbox('T8R-DEAD', ago(5 * 60_000));

    const job = makeJob();
    expect(await job.runOnce(NOW)).toBe(1);
    await job.runOnce(NOW);

    expect(await woCount('T8R-DEAD')).toBe(1);
    expect(await statusOf(id)).toBe(2);
  });

  it('a row locked by a busy worker is skipped, then processed once the lock is released', async () => {
    const id = await insertInbox('T8R-BUSY', ago(5 * 60_000));
    const job = makeJob();

    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from "IntegrationInbox" where "Id" = ${id} for update`);
      locked();
      await released;
    });
    try {
      await lockTaken;

      expect(await job.runOnce(NOW)).toBe(1);

      expect(await statusOf(id)).toBe(1);
      expect(await woCount('T8R-BUSY')).toBe(0);
    } finally {
      release();
      await holder;
    }

    expect(await job.runOnce(NOW)).toBe(1);
    expect(await statusOf(id)).toBe(2);
    expect(await woCount('T8R-BUSY')).toBe(1);
  });

  it('one row failing to process does not stop the rest of the batch', async () => {
    const a = await insertInbox('T8R-A', ago(5 * 60_000));
    const b = await insertInbox('T8R-B', ago(4 * 60_000));
    const job = makeJob();
    const real = (job as unknown as { processor: BookingInboxProcessor }).processor;
    const orig = real.process.bind(real);
    real.process = (async (id: bigint, now?: Date) => {
      if (id === a) throw new Error('db down');
      return orig(id, now);
    }) as typeof real.process;

    expect(await job.runOnce(NOW)).toBe(2);

    expect(await statusOf(a)).toBe(1);
    expect(await statusOf(b)).toBe(2);
  });
});

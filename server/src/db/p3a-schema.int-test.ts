import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootHttpContext, type HttpContext } from '../test/int-helpers';

// P3a tables and their DB-level invariants (Part 4 §4.4 E, F + design §4.2 deviations).

let ctx: HttpContext;

const cleanup = async () => {
  const { sql } = ctx;
  await sql`delete from "WorkOrderEvents" where "WorkOrderId" in (select "Id" from "WorkOrders" where "WorkOrderNo" like 'P3AT-%')`;
  await sql`delete from "WorkOrders" where "WorkOrderNo" like 'P3AT-%'`;
  await sql`delete from "BookingJobs" where "ExternalJobId" like 'P3AT-%'`;
  await sql`delete from "IntegrationInbox" where "Source" = 'P3AT'`;
  await sql`delete from "Teams" where "Code" like 'P3AT_%'`;
};

const insertJob = async (externalId: string, deviceRefs: string[] | null = null) => {
  const [row] = await ctx.sql`
    insert into "BookingJobs" ("ExternalJobId", "Status", "Raw", "PayloadHash", "DeviceRefs")
    values (${externalId}, 1, '{}'::jsonb, ${'a'.repeat(64)}, ${deviceRefs as never})
    returning "Id"`;
  return row.Id as bigint;
};

const insertWo = (no: string, jobId: bigint, status: number, closedAt: Date | null) =>
  ctx.sql`
    insert into "WorkOrders" ("WorkOrderNo", "Title", "Status", "BookingJobId", "ClosedAt")
    values (${no}, 't', ${status}, ${jobId}, ${closedAt})`;

const failsWith = async (p: PromiseLike<unknown>, name: string) => {
  await expect(Promise.resolve(p)).rejects.toMatchObject({ constraint_name: name });
};

describe('P3a schema', () => {
  beforeAll(async () => {
    ctx = await bootHttpContext();
  });
  beforeEach(async () => cleanup());
  afterAll(async () => {
    await cleanup();
    await ctx.close();
  });

  it('a Planned work order has no ClosedAt; Closed / Cancelled need one', async () => {
    const jobId = await insertJob('P3AT-1');
    await insertWo('P3AT-WO1', jobId, 6, null);
    const j2 = await insertJob('P3AT-2');
    await failsWith(insertWo('P3AT-WO2', j2, 2, null), 'CK_WO_Closed');
    await failsWith(insertWo('P3AT-WO2', j2, 3, null), 'CK_WO_Closed');
    await failsWith(insertWo('P3AT-WO2', j2, 6, new Date()), 'CK_WO_Closed');
    await insertWo('P3AT-WO2', j2, 2, new Date());
  });

  it('one work order per booking job; one inbox row per event', async () => {
    const jobId = await insertJob('P3AT-3');
    await insertWo('P3AT-WO3', jobId, 6, null);
    await failsWith(insertWo('P3AT-WO4', jobId, 6, null), 'UQ_WO_BookingJob');
    await failsWith(insertJob('P3AT-3'), 'UQ_BookingJobs_External');

    const ins = () => ctx.sql`
      insert into "IntegrationInbox" ("Source", "ExternalEventId", "Payload", "Status")
      values ('P3AT', 'evt-1', '{}'::jsonb, 1)`;
    await ins();
    await failsWith(ins(), 'UQ_Inbox_Event');
  });

  it('Teams.Code takes a 64-character team ref', async () => {
    const code = 'P3AT_' + 'x'.repeat(59);
    expect(code).toHaveLength(64);
    await ctx.sql`insert into "Teams" ("Code", "Name") values (${code}, 'n')`;
  });

  it('DeviceRefs is a text array searchable with &&', async () => {
    await insertJob('P3AT-4', ['1000027']);
    const rows = await ctx.sql`
      select "Id" from "BookingJobs"
      where "ExternalJobId" like 'P3AT-%' and "DeviceRefs" && ARRAY['1000027']::varchar[]`;
    expect(rows).toHaveLength(1);
  });
});

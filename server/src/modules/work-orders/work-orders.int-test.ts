import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import {
  bearerFor,
  bootHttpContext,
  createTestUsers,
  dropTestUsers,
  recordingGateway,
  resetDevices,
  type HttpContext,
} from '../../test/int-helpers';
import type { InboundJobV1 } from '../booking-integration/inbound/inbound-body';
import { BookingInboxProcessor } from '../booking-integration/processing/booking-inbox.processor';
import { BookingProjectionService } from '../booking-integration/projection/booking-projection.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import { WorkOrderWriter } from './work-order-writer.service';

// Design §4.8: read API of work orders. Data goes in through the real inbox processor.

const PREFIX = 'T9W-';
const USER_PREFIX = 't9w_';
const PASSWORD = 'Test@12345';
const NOW = new Date('2098-07-15T00:00:00Z');

let ctx: HttpContext;
let db: DrizzleDB;
let viewer: string;
let operator: string;

const processor = () =>
  new BookingInboxProcessor(
    db,
    new BookingProjectionService(),
    new WorkOrderWriter(),
    recordingGateway().gateway as unknown as RealtimeGateway,
  );

let seq = 0;
/** Pushes one job through the real processor; returns the work order id. */
const ingest = async (job: Partial<InboundJobV1> & { jobId: string }): Promise<string> => {
  const [row] = await ctx.sql`
    insert into "IntegrationInbox" ("Source", "ExternalEventId", "EventType", "Channel", "Payload", "Status", "Attempts")
    values ('BOOKING', ${`${PREFIX}evt-${++seq}-${randomUUID()}`}, 'job.updated', 1,
            ${JSON.stringify({ eventType: 'job.updated', job: { status: 'NEW', version: 1, ...job } })}::jsonb, 1, 0)
    returning "Id"`;
  expect(await processor().process(row.Id as bigint, NOW)).toBe('processed');
  const [wo] = await ctx.sql`
    select w."Id" from "WorkOrders" w join "BookingJobs" b on b."Id" = w."BookingJobId" where b."ExternalJobId" = ${job.jobId}`;
  return String(wo.Id);
};

const get = (path: string, auth = viewer) => ctx.http.get(`/api/work-orders${path}`).set('Authorization', auth);

const cleanup = async () => {
  await ctx.sql`
    delete from "WorkOrderEvents" where "WorkOrderId" in (
      select w."Id" from "WorkOrders" w join "BookingJobs" b on b."Id" = w."BookingJobId" where b."ExternalJobId" like ${PREFIX + '%'})`;
  await ctx.sql`
    delete from "WorkOrders" where "BookingJobId" in (select "Id" from "BookingJobs" where "ExternalJobId" like ${PREFIX + '%'})`;
  await ctx.sql`delete from "BookingJobs" where "ExternalJobId" like ${PREFIX + '%'}`;
  await ctx.sql`delete from "IntegrationInbox" where "ExternalEventId" like ${PREFIX + '%'}`;
  await ctx.sql`delete from "TeamMembers" where "TeamId" in (select "Id" from "Teams" where "Code" like ${PREFIX + '%'})`;
  await ctx.sql`delete from "Teams" where "Code" like ${PREFIX + '%'}`;
  await ctx.sql`delete from "WorkOrderCounters" where "Period" like '2098%'`;
};

beforeAll(async () => {
  ctx = await bootHttpContext();
  db = ctx.app.get<DrizzleDB>(DRIZZLE);
  await cleanup();
  await resetDevices(ctx.sql);
  await ctx.sql`
    insert into "Devices" ("DeviceCode", "VendorDeviceId", "Name", "Kind")
    values ('SIM-0001', 'SIM-0001', 'กล้อง 1', 1)`;
  const hash = await hashPassword(PASSWORD);
  const users = await createTestUsers(
    ctx.sql,
    [
      { username: `${USER_PREFIX}viewer`, role: 'VIEWER' },
      { username: `${USER_PREFIX}operator`, role: 'OPERATOR' },
      { username: `${USER_PREFIX}leader`, role: 'VIEWER' },
      { username: `${USER_PREFIX}nobody`, role: 'TEAM_LEADER' },
    ],
    hash,
  );
  await ctx.sql`
    update "Users" set "BookingEmployeeRef" = 'T9W-EMP-1', "FirstName" = 'สมชาย', "LastName" = 'ใจดี'
    where "Id" = ${users.get(`${USER_PREFIX}leader`)!}`;
  viewer = await bearerFor(ctx.http, `${USER_PREFIX}viewer`, PASSWORD);
  operator = await bearerFor(ctx.http, `${USER_PREFIX}operator`, PASSWORD);
});

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
  await resetDevices(ctx.sql);
  await dropTestUsers(ctx.sql, [`${USER_PREFIX}%`]);
  await ctx.close();
});

describe('GET /api/work-orders', () => {
  it('lists Planned and Open first with workWindow, booking summary and cameras with platformState', async () => {
    const closedId = await ingest({
      jobId: 'T9W-CLOSED',
      version: 2,
      status: 'DONE',
      jobNo: 'JN-CLOSED',
      checkInAt: '2098-07-14T01:00:00Z',
      checkOutAt: '2098-07-14T05:00:00Z',
    });
    const openId = await ingest({
      jobId: 'T9W-OPEN',
      version: 1,
      status: 'IN_PROGRESS',
      jobNo: 'JN-OPEN',
      doNo: 'DO-9',
      shNo: 'SH-9',
      title: 'ติดตั้งกล้อง อาคาร B',
      teamRef: 'T9W-TEAM-A',
      leaderRef: 'T9W-EMP-1',
      plannedStartAt: '2098-07-15T01:00:00Z',
      plannedEndAt: '2098-07-15T09:00:00Z',
      checkInAt: '2098-07-15T02:00:00Z',
      deviceRefs: ['SIM-0001'],
      site: { name: 'อาคาร B' },
    });
    const plannedId = await ingest({ jobId: 'T9W-PLANNED', version: 1, status: 'NEW', jobNo: 'JN-PLANNED' });

    const r = await get('?pageSize=50&q=T9W-');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ page: 1, pageSize: 50, total: 3 });
    const ids = r.body.data.map((x: { id: string }) => x.id);
    // Planned and Open first (newest first among them), the closed one last
    expect(ids.slice(0, 2).sort()).toEqual([openId, plannedId].sort());
    expect(ids[2]).toBe(closedId);

    const open = r.body.data.find((x: { id: string }) => x.id === openId);
    expect(open).toMatchObject({
      id: openId,
      title: 'ติดตั้งกล้อง อาคาร B',
      status: 1,
      needsReview: false,
      team: { code: expect.any(String) },
      booking: {
        externalJobNo: 'JN-OPEN',
        doNo: 'DO-9',
        shNo: 'SH-9',
        plannedStartAt: '2098-07-15T01:00:00.000Z',
        plannedEndAt: '2098-07-15T09:00:00.000Z',
        siteName: 'อาคาร B',
      },
      workWindow: { from: '2098-07-15T02:00:00.000Z', to: null },
      openedAt: '2098-07-15T02:00:00.000Z',
      closedAt: null,
      lastActivityAt: null,
      rowVersion: 1,
    });
    expect(open.cameras).toEqual([
      {
        deviceRef: 'SIM-0001',
        deviceId: expect.any(String),
        deviceCode: 'SIM-0001',
        name: 'กล้อง 1',
        platformState: 'online',
        platformStatusFetchedAt: expect.any(String),
        fromSession: false,
      },
    ]);
    const planned = r.body.data.find((x: { id: string }) => x.id === plannedId);
    expect(planned).toMatchObject({ status: 6, workWindow: null, cameras: [] });
    const closed = r.body.data.find((x: { id: string }) => x.id === closedId);
    expect(closed).toMatchObject({
      status: 2,
      workWindow: { from: '2098-07-14T01:00:00.000Z', to: '2098-07-14T05:00:00.000Z' },
    });
  });

  it('status=6 filters; q finds by WO no, DO, SH, booking job no and team name', async () => {
    const planned = await ingest({
      jobId: 'T9W-F1',
      version: 1,
      status: 'NEW',
      jobNo: 'JN-FIND-1',
      doNo: 'DO-FIND-1',
      shNo: 'SH-FIND-1',
      teamRef: 'T9W-TEAM-B',
    });
    await ingest({ jobId: 'T9W-F2', version: 1, status: 'IN_PROGRESS', jobNo: 'JN-FIND-2', checkInAt: '2098-07-15T02:00:00Z' });

    const only6 = await get('?status=6&q=T9W-F');
    expect(only6.body.total).toBe(1);
    expect(only6.body.data[0].id).toBe(planned);
    expect((await get('?status=1&q=T9W-F')).body.total).toBe(1);
    expect((await get('?status=3&q=T9W-F')).body.total).toBe(0);

    const [{ WorkOrderNo }] = await ctx.sql`select "WorkOrderNo" from "WorkOrders" where "Id" = ${planned}`;
    const [team] = await ctx.sql`select "Name" from "Teams" where "BookingTeamRef" = 'T9W-TEAM-B'`;
    for (const q of [WorkOrderNo, 'DO-FIND-1', 'SH-FIND-1', 'JN-FIND-1', 'T9W-F1', team.Name]) {
      const r = await get(`?q=${encodeURIComponent(q)}`);
      expect(r.body.data.map((x: { id: string }) => x.id), `q=${q}`).toContain(planned);
    }
    expect((await get('?q=NOPE-NOT-THERE')).body.total).toBe(0);
    expect((await get('?status=7')).status).toBe(400);
  });

  it('an unknown deviceRef shows deviceId null and unknown state', async () => {
    await ingest({ jobId: 'T9W-REF', version: 1, status: 'NEW', deviceRefs: ['NO-SUCH-CAM', 'SIM-0001'] });
    const r = await get('?q=T9W-REF');
    expect(r.body.data[0].cameras).toMatchObject([
      { deviceRef: 'NO-SUCH-CAM', deviceId: null, deviceCode: null, name: null, platformState: 'unknown', platformStatusFetchedAt: null },
      { deviceRef: 'SIM-0001', deviceCode: 'SIM-0001', platformState: 'online' },
    ]);
  });
});

describe('GET /api/work-orders/:id', () => {
  it('detail: full booking with booking:read, summary only without it', async () => {
    const id = await ingest({
      jobId: 'T9W-DETAIL',
      version: 1,
      status: 'NEW',
      jobNo: 'JN-D',
      doNo: 'DO-D',
      shNo: 'SH-D',
      scheduledDate: '2098-07-15',
      plannedStartAt: '2098-07-15T01:00:00Z',
      deviceRefs: ['SIM-0001'],
      site: { name: 'อาคาร B', address: 'ถนนสุขุมวิท', lat: 13.7, lng: 100.5 },
    });

    const full = await get(`/${id}`, operator);
    expect(full.status).toBe(200);
    expect(full.body).toMatchObject({
      id,
      status: 6,
      closeReason: null,
      reviewReasons: [],
      note: null,
      availableActions: [],
      cameras: [{ deviceRef: 'SIM-0001', platformState: 'online' }],
      booking: {
        sourceSystem: 'BOOKING',
        externalJobId: 'T9W-DETAIL',
        externalJobNo: 'JN-D',
        doNo: 'DO-D',
        shNo: 'SH-D',
        status: 1,
        scheduledDate: '2098-07-15',
        checkInAt: null,
        checkOutAt: null,
        deviceRefs: ['SIM-0001'],
        site: { name: 'อาคาร B', address: 'ถนนสุขุมวิท', lat: 13.7, lng: 100.5 },
        detail: true,
      },
    });
    expect(typeof full.body.booking.lastSyncedAt).toBe('string');

    // a role without booking:read sees only the summary of the list row
    const [{ Id: viewerRole }] = await ctx.sql`select "Id" from "Roles" where "Code" = 'VIEWER'`;
    const [grant] = await ctx.sql`
      select rp."RoleId", rp."PermissionId" from "RolePermissions" rp join "Permissions" p on p."Id" = rp."PermissionId"
      where rp."RoleId" = ${viewerRole} and p."Code" = 'booking:read'`;
    expect(grant).toBeDefined();
    await ctx.sql`delete from "RolePermissions" where "RoleId" = ${grant.RoleId} and "PermissionId" = ${grant.PermissionId}`;
    try {
      const noBooking = await bearerFor(ctx.http, `${USER_PREFIX}viewer`, PASSWORD);
      const slim = await get(`/${id}`, noBooking);
      expect(slim.status).toBe(200);
      expect(slim.body.booking).toEqual({
        id: expect.any(String),
        externalJobNo: 'JN-D',
        doNo: 'DO-D',
        shNo: 'SH-D',
        plannedStartAt: '2098-07-15T01:00:00.000Z',
        plannedEndAt: null,
        siteName: 'อาคาร B',
        detail: false,
      });
      expect(slim.body.booking).not.toHaveProperty('externalJobId');
    } finally {
      await ctx.sql`insert into "RolePermissions" ("RoleId", "PermissionId") values (${grant.RoleId}, ${grant.PermissionId}) on conflict do nothing`;
    }
  });

  it('unknown id ⇒ 404', async () => {
    const r = await get('/999999999');
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect((await get('/999999999/events')).status).toBe(404);
  });
});

describe('GET /api/work-orders/:id/events', () => {
  it('events in time order', async () => {
    const id = await ingest({ jobId: 'T9W-EV', version: 1, status: 'IN_PROGRESS', checkInAt: '2098-07-15T02:00:00Z' });
    await ingest({
      jobId: 'T9W-EV',
      version: 2,
      status: 'DONE',
      checkInAt: '2098-07-15T02:00:00Z',
      checkOutAt: '2098-07-15T06:00:00Z',
    });

    const r = await get(`/${id}/events`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject([
      { eventType: 1, fromStatus: null, toStatus: 1, source: 2 },
      { eventType: 2, fromStatus: 1, toStatus: 2, source: 2, reason: 'BookingCheckout' },
    ]);
    const times = r.body.data.map((e: { occurredAt: string }) => Date.parse(e.occurredAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(typeof r.body.data[0].id).toBe('string');
  });
});

describe('permissions', () => {
  it('needs work-orders:read ⇒ 403', async () => {
    const nobody = await bearerFor(ctx.http, `${USER_PREFIX}nobody`, PASSWORD);
    expect((await get('', nobody)).status).toBe(403);
    expect((await get('/1', nobody)).status).toBe(403);
    expect((await get('/1/events', nobody)).status).toBe(403);
    expect((await ctx.http.get('/api/work-orders')).status).toBe(401);
  });
});

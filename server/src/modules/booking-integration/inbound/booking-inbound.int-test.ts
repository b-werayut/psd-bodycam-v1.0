import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { bootHttpContext, type HttpContext } from '../../../test/int-helpers';
import { BOOKING_INBOX_QUEUE } from '../../../common/queue/queue.module';
import type { BookingInboxJob } from '../../../common/queue/queue.constants';
import { signBody } from './inbound-auth';

const URL = '/api/integration/booking/jobs';
const SECRET = 'test-secret-1';

const body = (over: Record<string, unknown> = {}) => ({
  eventId: 'evt-1',
  job: { jobId: 'J-1', status: 'NEW', version: 1 },
  ...over,
});

let ctx: HttpContext;
let queue: Queue<BookingInboxJob>;

function signed(raw: string, ts = String(Math.floor(Date.now() / 1000)), secret = SECRET) {
  return ctx.http
    .post(URL)
    .set('Content-Type', 'application/json')
    .set('X-Booking-Timestamp', ts)
    .set('X-Booking-Signature', signBody(secret, ts, raw))
    .send(raw);
}

const count = async (table: string) =>
  Number((await ctx.sql.unsafe(`select count(*)::int as n from "${table}"`))[0]!.n);

describe('POST /api/integration/booking/jobs', () => {
  beforeAll(async () => {
    ctx = await bootHttpContext();
    queue = ctx.app.get(BOOKING_INBOX_QUEUE);
  });
  afterAll(async () => {
    await queue?.obliterate({ force: true });
    await ctx.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await ctx.sql.unsafe(`delete from "IntegrationInbox" where "Source"='BOOKING'`);
    await ctx.sql.unsafe(`delete from "IntegrationCallLogs" where "Source"='BOOKING'`);
    await ctx.sql.unsafe(`delete from "IntegrationSyncState" where "Source"='BOOKING'`);
    await queue.obliterate({ force: true });
  });

  it('a signed new job ⇒ 202 accepted, one Pending inbox row, LastReceivedAt set, one booking-inbox job', async () => {
    const res = await signed(JSON.stringify(body()));
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'accepted', externalJobId: 'J-1' });
    expect(typeof res.body.correlationId).toBe('string');
    const rows = await ctx.sql.unsafe(
      `select "Id","Status","Channel","ExternalEventId" from "IntegrationInbox" where "Source"='BOOKING'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ Status: 1, Channel: 1, ExternalEventId: 'evt-1' });
    const st = await ctx.sql.unsafe(
      `select "LastReceivedAt" from "IntegrationSyncState" where "Source"='BOOKING' and "Resource"='jobs'`,
    );
    expect(st[0]!.LastReceivedAt).not.toBeNull();
    const job = await queue.getJob(`inbox-${rows[0]!.Id}`);
    expect(job?.data).toEqual({ inboxId: String(rows[0]!.Id) });
    const logs = await ctx.sql.unsafe(
      `select "HttpStatus","Direction","Operation","Outcome" from "IntegrationCallLogs" where "Source"='BOOKING'`,
    );
    expect(logs).toEqual([{ HttpStatus: 202, Direction: 2, Operation: 'inbound.job', Outcome: 1 }]);
  });

  it('the same eventId again ⇒ 200 duplicate, still one row', async () => {
    await signed(JSON.stringify(body()));
    const stateSql = `select "LastReceivedAt" from "IntegrationSyncState" where "Source"='BOOKING' and "Resource"='jobs'`;
    const first = (await ctx.sql.unsafe(stateSql))[0]!.LastReceivedAt as Date;
    await queue.obliterate({ force: true });
    await new Promise((r) => setTimeout(r, 20));
    const res = await signed(JSON.stringify(body()));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('duplicate');
    expect(await count('IntegrationInbox')).toBe(1);
    const second = (await ctx.sql.unsafe(stateSql))[0]!.LastReceivedAt as Date;
    expect(second.getTime()).toBeGreaterThan(first.getTime());
    const counts = await queue.getJobCounts('waiting', 'delayed', 'active', 'completed', 'failed');
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0);
    const logs = await ctx.sql.unsafe(
      `select "HttpStatus" from "IntegrationCallLogs" where "Source"='BOOKING' order by "Id"`,
    );
    expect(logs.map((l) => l.HttpStatus)).toEqual([202, 200]);
  });

  it('malformed JSON ⇒ 400 VALIDATION_FAILED with a details entry, call-logged', async () => {
    const res = await signed('{"job": ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details).toEqual([expect.objectContaining({ field: 'body' })]);
    const logs = await ctx.sql.unsafe(`select "HttpStatus" from "IntegrationCallLogs" where "Source"='BOOKING'`);
    expect(logs).toEqual([{ HttpStatus: 400 }]);
    expect(await count('IntegrationInbox')).toBe(0);
  });

  it('300 KB and 1.5 MB bodies ⇒ 413 PAYLOAD_TOO_LARGE with the standard body, both call-logged', async () => {
    for (const kb of [300, 1536]) {
      const res = await signed(JSON.stringify(body({ pad: 'x'.repeat(kb * 1024) })));
      expect(res.status).toBe(413);
      expect(res.body).toMatchObject({ statusCode: 413, code: 'PAYLOAD_TOO_LARGE' });
      expect(typeof res.body.correlationId).toBe('string');
    }
    const logs = await ctx.sql.unsafe(`select "HttpStatus" from "IntegrationCallLogs" where "Source"='BOOKING'`);
    expect(logs).toEqual([{ HttpStatus: 413 }, { HttpStatus: 413 }]);
  });

  it('other routes keep the 1 MB JSON parser', async () => {
    const res = await ctx.http.post('/api/auth/login').send({ username: 'x', password: 'y'.repeat(1.5 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('bad signature / timestamp 301 s old / missing headers ⇒ 401 INBOUND_AUTH_FAILED, no inbox row, a call log with HttpStatus 401 and Direction 2', async () => {
    const raw = JSON.stringify(body());
    const now = Math.floor(Date.now() / 1000);
    const bad = await signed(raw, String(now), 'wrong-secret');
    const old = await signed(raw, String(now - 301));
    const none = await ctx.http.post(URL).set('Content-Type', 'application/json').send(raw);
    for (const r of [bad, old, none]) {
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('INBOUND_AUTH_FAILED');
      expect(r.body.message).toBe('ยืนยันตัวตนไม่ผ่าน');
    }
    expect(await count('IntegrationInbox')).toBe(0);
    const logs = await ctx.sql.unsafe(
      `select "HttpStatus","Direction" from "IntegrationCallLogs" where "Source"='BOOKING'`,
    );
    expect(logs).toHaveLength(3);
    expect(logs.every((l) => l.HttpStatus === 401 && l.Direction === 2)).toBe(true);
  });

  it('missing job.status ⇒ 400 VALIDATION_FAILED with details, call log 400', async () => {
    const res = await signed(JSON.stringify({ eventId: 'e', job: { jobId: 'J', version: 1 } }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details).toEqual([expect.objectContaining({ field: 'job.status' })]);
    const logs = await ctx.sql.unsafe(
      `select "HttpStatus","Outcome" from "IntegrationCallLogs" where "Source"='BOOKING'`,
    );
    expect(logs).toEqual([{ HttpStatus: 400, Outcome: 2 }]);
  });

  it('text/plain ⇒ 415; a 300 KB body ⇒ 413', async () => {
    const t = await ctx.http.post(URL).set('Content-Type', 'text/plain').send('hello');
    expect(t.status).toBe(415);
    expect(t.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const big = JSON.stringify(body({ pad: 'x'.repeat(300 * 1024) }));
    const b = await signed(big);
    expect(b.status).toBe(413);
    expect(b.body.code).toBe('PAYLOAD_TOO_LARGE');
    const logs = await ctx.sql.unsafe(
      `select "HttpStatus","RequestExcerpt" from "IntegrationCallLogs" where "Source"='BOOKING' order by "Id"`,
    );
    expect(logs.map((l) => l.HttpStatus)).toEqual([415, 413]);
    expect(logs.every((l) => (l.RequestExcerpt ?? '').length <= 4096)).toBe(true);
  });

  it('a job is still accepted when the queue is unavailable', async () => {
    vi.spyOn(queue, 'add').mockRejectedValue(new Error('down'));
    const res = await signed(JSON.stringify(body()));
    expect(res.status).toBe(202);
    const rows = await ctx.sql.unsafe(`select "Status" from "IntegrationInbox" where "Source"='BOOKING'`);
    expect(rows).toEqual([{ Status: 1 }]);
  });

  it('call logs never contain the signature header or the secret', async () => {
    await signed(JSON.stringify(body()));
    await signed(JSON.stringify(body({ eventId: 'e2' })), String(Math.floor(Date.now() / 1000)), 'nope');
    const logs = await ctx.sql.unsafe(
      `select "RequestExcerpt","ErrorMessage","ResponseExcerpt","Url" from "IntegrationCallLogs" where "Source"='BOOKING'`,
    );
    expect(logs).toHaveLength(2);
    const all = JSON.stringify(logs);
    expect(all).not.toContain('sha256=');
    expect(all).not.toContain('test-secret');
  });
});

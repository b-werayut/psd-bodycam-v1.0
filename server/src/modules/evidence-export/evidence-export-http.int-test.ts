import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { EVIDENCE_EXPORT_QUEUE } from '../../common/queue/queue.module';
import { bearerFor, bootHttpContext, createTestUsers, dropTestUsers, type HttpContext } from '../../test/int-helpers';
import { streamUrlKey } from '../streaming/url-seal';
import { sealDownloadTicket } from './download-ticket';

const PREFIX = 't_evxh_';
const CODE = 'TEST-EVXH-CAM';
const PASSWORD = 'Test@12345';
const FILE = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
let ctx: HttpContext;
let operator: string;
let operatorId: bigint;
let storageDir: string;
let deviceId: bigint;

const bytes = (res: { on(e: string, f: (c?: Buffer) => void): void }, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c) => chunks.push(c as Buffer));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

const insertReady = async (overrides: { expired?: boolean; withFile?: boolean } = {}) => {
  const rel = `evidence/test-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  if (overrides.withFile !== false) writeFileSync(join(storageDir, rel), FILE);
  const expires = overrides.expired ? new Date(Date.now() - 60_000) : new Date(Date.now() + 3_600_000);
  const [row] = await ctx.sql`
    insert into "EvidenceExports" ("DeviceId", "StartAt", "EndAt", "Status", "Progress", "FilePath", "FileName", "FileSizeBytes", "RequestedBy", "CompletedAt", "ExpiresAt")
    values (${deviceId}, now() - interval '2 hours', now() - interval '1 hour', 3, 100, ${rel}, 'evidence_TEST_20261125-170630.mp4', ${FILE.length},
      ${operatorId}, now(), ${expires})
    returning "Id"`;
  return String(row.Id);
};
const ticketFor = (id: string) => ctx.http.post(`/api/evidence-exports/${id}/download-ticket`).set('Authorization', operator);

const withoutDownloadGrant = async (fn: () => Promise<void>) => {
  const [grant] = await ctx.sql`
    select rp."RoleId", rp."PermissionId" from "RolePermissions" rp
    join "Permissions" p on p."Id" = rp."PermissionId" join "Roles" r on r."Id" = rp."RoleId"
    where r."Code" = 'OPERATOR' and p."Code" = 'evidence:download'`;
  await ctx.sql`delete from "RolePermissions" where "RoleId" = ${grant.RoleId} and "PermissionId" = ${grant.PermissionId}`;
  try {
    await fn();
  } finally {
    await ctx.sql`insert into "RolePermissions" ("RoleId", "PermissionId") values (${grant.RoleId}, ${grant.PermissionId}) on conflict do nothing`;
  }
};

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), 'evxh-int-'));
  mkdirSync(join(storageDir, 'evidence'));
  vi.stubEnv('STORAGE_LOCAL_DIR', storageDir);
  ctx = await bootHttpContext();
  (ctx.app.get(EVIDENCE_EXPORT_QUEUE) as { add: unknown }).add = vi.fn().mockResolvedValue({});
  await ctx.sql`delete from "EvidenceExports" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
  await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
  const [dev] = await ctx.sql`insert into "Devices" ("DeviceCode", "VendorDeviceId", "Name", "Kind") values (${CODE}, 'vendor-test-evxh', 'Test export camera', 1) returning "Id"`;
  deviceId = dev.Id as bigint;
  const ids = await createTestUsers(ctx.sql, [{ username: `${PREFIX}operator`, role: 'OPERATOR' }], await hashPassword(PASSWORD));
  operatorId = ids.get(`${PREFIX}operator`) as bigint;
  operator = await bearerFor(ctx.http, `${PREFIX}operator`, PASSWORD);
});

beforeEach(async () => {
  await ctx.sql`delete from "EvidenceExports" where "DeviceId" = ${deviceId}`;
});

afterAll(async () => {
  if (ctx) {
    await ctx.sql`delete from "EvidenceExports" where "DeviceId" = ${deviceId}`;
    await ctx.sql`delete from "AuditLogs" where "ActorUsername" like ${`${PREFIX}%`}`;
    await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
    await dropTestUsers(ctx.sql, [`${PREFIX}%`]);
    await ctx.close();
  }
  vi.unstubAllEnvs();
  rmSync(storageDir, { recursive: true, force: true });
});

describe('download ticket and file', () => {
  it('Ready export with a file: ticket then 200 with headers and bytes, Range gives 206, audited', async () => {
    const id = await insertReady();
    const t = await ticketFor(id);
    expect(t.status).toBe(201);
    expect(t.body.fileName).toBe('evidence_TEST_20261125-170630.mp4');
    expect(t.body.url).toMatch(/^\/api\/evidence-exports\/download\?ticket=/);

    const full = await ctx.http.get(t.body.url).buffer(true).parse(bytes);
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toContain('video/mp4');
    expect(full.headers['content-disposition']).toBe('attachment; filename="evidence_TEST_20261125-170630.mp4"');
    expect(Buffer.compare(full.body as Buffer, FILE)).toBe(0);

    const part = await ctx.http.get(t.body.url).set('Range', 'bytes=0-9').buffer(true).parse(bytes);
    expect(part.status).toBe(206);
    expect((part.body as Buffer).toString()).toBe('0123456789');

    const audit = await ctx.sql`select 1 from "AuditLogs" where "ActorUsername" = ${`${PREFIX}operator`} and "Action" = 'DOWNLOAD_EVIDENCE_EXPORT'`;
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it('a role with export but without download cannot get a ticket', async () => {
    const id = await insertReady();
    await withoutDownloadGrant(async () => {
      const noDownload = await bearerFor(ctx.http, `${PREFIX}operator`, PASSWORD);
      const res = await ctx.http.post(`/api/evidence-exports/${id}/download-ticket`).set('Authorization', noDownload);
      expect(res.status).toBe(403);
    });
  });

  it('an issued ticket stops working once the download grant is revoked', async () => {
    const id = await insertReady();
    const t = await ticketFor(id);
    await withoutDownloadGrant(async () => {
      expect((await ctx.http.get(t.body.url)).status).toBe(403);
    });
  });

  it('an unsatisfiable Range answers 416 instead of hanging', async () => {
    const id = await insertReady();
    const t = await ticketFor(id);
    const res = await ctx.http.get(t.body.url).set('Range', 'bytes=1000-2000').timeout(3000);
    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe(`bytes */${FILE.length}`);
  });

  it('a file deleted after the ticket was issued answers 404 instead of hanging', async () => {
    const id = await insertReady();
    const t = await ticketFor(id);
    const [row] = await ctx.sql`select "FilePath" from "EvidenceExports" where "Id" = ${id}`;
    rmSync(join(storageDir, row.FilePath as string));
    const res = await ctx.http.get(t.body.url).timeout(3000);
    expect(res.status).toBe(404);
  });

  it('a ticket older than 60 s is 404', async () => {
    const id = await insertReady();
    const old = sealDownloadTicket({ exportId: BigInt(id), userId: operatorId }, streamUrlKey(), new Date(Date.now() - 61_000));
    const res = await ctx.http.get(`/api/evidence-exports/download?ticket=${encodeURIComponent(old)}`);
    expect(res.status).toBe(404);
  });

  it('garbage and missing tickets are rejected', async () => {
    expect((await ctx.http.get('/api/evidence-exports/download?ticket=xyz')).status).toBe(404);
    expect((await ctx.http.get('/api/evidence-exports/download')).status).toBe(400);
  });

  it('expired export: ticket 404 EXPORT_EXPIRED (Thai)', async () => {
    const id = await insertReady({ expired: true });
    const res = await ticketFor(id);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('EXPORT_EXPIRED');
    expect(res.body.message).toMatch(/[฀-๿]/);
  });

  it('ticket issued while valid, then the row expires: download is 404', async () => {
    const id = await insertReady();
    const t = await ticketFor(id);
    await ctx.sql`update "EvidenceExports" set "ExpiresAt" = now() - interval '1 minute' where "Id" = ${id}`;
    expect((await ctx.http.get(t.body.url)).status).toBe(404);
  });

  it('missing file or not-ready row: 404 EXPORT_NOT_READY (Thai)', async () => {
    const noFile = await insertReady({ withFile: false });
    const a = await ticketFor(noFile);
    expect(a.status).toBe(404);
    expect(a.body.code).toBe('EXPORT_NOT_READY');
    expect(a.body.message).toMatch(/[฀-๿]/);
    const [queued] = await ctx.sql`insert into "EvidenceExports" ("DeviceId", "StartAt", "EndAt", "RequestedBy") values (${deviceId}, now() - interval '3 hours', now() - interval '2 hours', ${operatorId}) returning "Id"`;
    const b = await ticketFor(String(queued.Id));
    expect(b.status).toBe(404);
    expect(b.body.code).toBe('EXPORT_NOT_READY');
  });

  it('unknown id: 404 EXPORT_NOT_FOUND', async () => {
    const res = await ticketFor('999999999');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('EXPORT_NOT_FOUND');
  });
});

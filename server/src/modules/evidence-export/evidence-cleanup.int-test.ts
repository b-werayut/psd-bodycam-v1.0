import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { bootHttpContext, createTestUsers, dropTestUsers, type HttpContext } from '../../test/int-helpers';
import { EvidenceCleanupJob } from './evidence-cleanup.job';

const PREFIX = 't_evc_';
const CODE = 'TEST-EVC-CAM';
const NOW = new Date('2026-11-27T12:00:00.000Z');

let ctx: HttpContext;
let db: DrizzleDB;
let storageDir: string;
let userId: bigint;
let deviceId: bigint;

const file = (name: string, mtime?: Date): string => {
  const path = join(storageDir, 'evidence', name);
  writeFileSync(path, 'x');
  if (mtime) utimesSync(path, mtime, mtime);
  return path;
};
const insertReady = async (name: string, expiresAt: Date, minute: number): Promise<bigint> => {
  const start = new Date(Date.UTC(2026, 10, 20, 3, minute));
  const [row] = await ctx.sql`
    insert into "EvidenceExports" ("DeviceId", "StartAt", "EndAt", "Status", "RequestedBy", "FilePath", "FileName", "CompletedAt", "ExpiresAt")
    values (${deviceId}, ${start}, ${new Date(start.getTime() + 60_000)}, 3, ${userId}, ${`evidence/${name}`}, ${name},
            ${new Date(expiresAt.getTime() - 24 * 3_600_000)}, ${expiresAt})
    returning "Id"`;
  return row.Id as bigint;
};
const statusOf = async (id: bigint) => (await ctx.sql`select "Status" from "EvidenceExports" where "Id" = ${id}`)[0].Status;

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), 'evc-storage-'));
  vi.stubEnv('STORAGE_LOCAL_DIR', storageDir);
  ctx = await bootHttpContext();
  db = ctx.app.get<DrizzleDB>(DRIZZLE);
  await ctx.sql`delete from "EvidenceExports" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
  await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
  const ids = await createTestUsers(ctx.sql, [{ username: `${PREFIX}op`, role: 'OPERATOR' }], await hashPassword('Test@12345'));
  userId = ids.get(`${PREFIX}op`)!;
  const [device] = await ctx.sql`
    insert into "Devices" ("DeviceCode", "VendorDeviceId", "Name", "Kind") values (${CODE}, 'vendor-test-evc', 'Test export camera', 1)
    returning "Id"`;
  deviceId = device.Id as bigint;
});
beforeEach(async () => {
  await ctx.sql`delete from "EvidenceExports" where "DeviceId" = ${deviceId}`;
  rmSync(join(storageDir, 'evidence'), { recursive: true, force: true });
  mkdirSync(join(storageDir, 'evidence'), { recursive: true });
});
afterAll(async () => {
  if (ctx) {
    await ctx.sql`delete from "EvidenceExports" where "DeviceId" = ${deviceId}`;
    await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
    await dropTestUsers(ctx.sql, [`${PREFIX}%`]);
    await ctx.close();
  }
  vi.unstubAllEnvs();
  rmSync(storageDir, { recursive: true, force: true });
});

describe('EvidenceCleanupJob.purgeExpired', () => {
  it('expired Ready -> file deleted and Expired; unexpired Ready untouched', async () => {
    const oldPath = file('old.mp4');
    const freshPath = file('fresh.mp4');
    const old = await insertReady('old.mp4', new Date(NOW.getTime() - 1000), 1);
    const fresh = await insertReady('fresh.mp4', new Date(NOW.getTime() + 3_600_000), 2);

    const count = await new EvidenceCleanupJob(db).purgeExpired(NOW);

    expect(count).toBe(1);
    expect(await statusOf(old)).toBe(5);
    expect(existsSync(oldPath)).toBe(false);
    expect(await statusOf(fresh)).toBe(3);
    expect(existsSync(freshPath)).toBe(true);
  });

  it('a file that is already gone still becomes Expired', async () => {
    const id = await insertReady('missing.mp4', new Date(NOW.getTime() - 1000), 1);

    await new EvidenceCleanupJob(db).purgeExpired(NOW);

    expect(await statusOf(id)).toBe(5);
  });

  it('a path escaping the storage root is not deleted and the row still expires', async () => {
    const outsideName = `evc-outside-${Date.now()}.mp4`;
    const outside = join(tmpdir(), outsideName); // storageDir lives directly in tmpdir()
    writeFileSync(outside, 'x');
    const [row] = await ctx.sql`
      insert into "EvidenceExports" ("DeviceId", "StartAt", "EndAt", "Status", "RequestedBy", "FilePath", "ExpiresAt")
      values (${deviceId}, ${new Date()}, ${new Date()}, 3, ${userId}, ${`../${outsideName}`}, ${new Date(NOW.getTime() - 1000)})
      returning "Id"`;

    await new EvidenceCleanupJob(db).purgeExpired(NOW);

    expect(existsSync(outside)).toBe(true);
    expect(await statusOf(row.Id as bigint)).toBe(5);
    rmSync(outside, { force: true });
  });

  it('removes evidence/*.part older than 1 h, keeps fresh ones and finished files', async () => {
    const oldPart = file('a.mp4.1.part', new Date(NOW.getTime() - 2 * 3_600_000));
    const freshPart = file('b.mp4.2.part', new Date(NOW.getTime() - 5 * 60_000));
    const other = file('keep.mp4', new Date(NOW.getTime() - 5 * 3_600_000));

    await new EvidenceCleanupJob(db).purgeExpired(NOW);

    expect(existsSync(oldPart)).toBe(false);
    expect(existsSync(freshPart)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  it('no evidence directory yet is fine', async () => {
    rmSync(join(storageDir, 'evidence'), { recursive: true, force: true });

    await expect(new EvidenceCleanupJob(db).purgeExpired(NOW)).resolves.toBe(0);
  });
});

describe('EvidenceCleanupJob stuck Processing rows', () => {
  const insertProcessing = async (startedAgoMs: number, minute: number): Promise<bigint> => {
    const start = new Date(Date.UTC(2026, 10, 20, 4, minute));
    const [row] = await ctx.sql`
      insert into "EvidenceExports" ("DeviceId", "StartAt", "EndAt", "Status", "RequestedBy", "StartedAt")
      values (${deviceId}, ${start}, ${new Date(start.getTime() + 60_000)}, 2, ${userId}, ${new Date(NOW.getTime() - startedAgoMs)})
      returning "Id"`;
    return row.Id as bigint;
  };

  it('a row started 4 h ago (timeout 180 min + 5 min grace) is Failed by one round; a fresh one stays', async () => {
    const stuck = await insertProcessing(4 * 3_600_000, 1);
    const fresh = await insertProcessing(5 * 60_000, 2);

    await new EvidenceCleanupJob(db).purgeExpired(NOW);

    const [row] = await ctx.sql`select "Status", "ErrorMessage", "CompletedAt" from "EvidenceExports" where "Id" = ${stuck}`;
    expect(row.Status).toBe(4);
    expect(row.ErrorMessage).toBe('งานค้าง กรุณาสั่งใหม่');
    expect(row.CompletedAt).toBeInstanceOf(Date);
    expect(await statusOf(fresh)).toBe(2);
  });

  it('a row still inside timeout + 5 min (3 h 4 min) is left alone', async () => {
    const inside = await insertProcessing(3 * 3_600_000 + 4 * 60_000, 1);

    await new EvidenceCleanupJob(db).purgeExpired(NOW);

    expect(await statusOf(inside)).toBe(2);
  });
});

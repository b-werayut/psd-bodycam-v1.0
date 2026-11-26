import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { bootHttpContext, createTestUsers, dropTestUsers, eventually, type HttpContext } from '../../test/int-helpers';
import { SettingsService } from '../../common/settings/settings.service';
import { LiveStreamProvider } from '../streaming/live-stream.provider';
import { RecordingProvider } from '../streaming/recording-provider';
import { EvidenceExportProcessor } from './evidence-export.processor';
import { EvidenceExportWorker } from './evidence-export.worker';

const PREFIX = 't_evw_';
const CODE = 'TEST-EVW-CAM';

let ctx: HttpContext;
let db: DrizzleDB;
let userId: bigint;
let deviceId: bigint;

const insertExport = async (status: number, startedAgoMs: number | null, minute: number): Promise<bigint> => {
  const start = new Date(Date.UTC(2026, 10, 20, 3, minute));
  const [row] = await ctx.sql`
    insert into "EvidenceExports" ("DeviceId", "StartAt", "EndAt", "Status", "RequestedBy", "StartedAt")
    values (${deviceId}, ${start}, ${new Date(start.getTime() + 60_000)}, ${status}, ${userId},
            ${startedAgoMs === null ? null : new Date(Date.now() - startedAgoMs)})
    returning "Id"`;
  return row.Id as bigint;
};
const rowOf = async (id: bigint) => (await ctx.sql`select * from "EvidenceExports" where "Id" = ${id}`)[0];

beforeAll(async () => {
  ctx = await bootHttpContext();
  db = ctx.app.get<DrizzleDB>(DRIZZLE);
  await ctx.sql`delete from "EvidenceExports" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
  await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
  const ids = await createTestUsers(ctx.sql, [{ username: `${PREFIX}op`, role: 'OPERATOR' }], await hashPassword('Test@12345'));
  userId = ids.get(`${PREFIX}op`)!;
  const [device] = await ctx.sql`
    insert into "Devices" ("DeviceCode", "VendorDeviceId", "Name", "Kind") values (${CODE}, 'vendor-test-evw', 'Test export camera', 1)
    returning "Id"`;
  deviceId = device.Id as bigint;
});
beforeEach(async () => {
  await ctx.sql`delete from "EvidenceExports" where "DeviceId" = ${deviceId}`;
  vi.stubEnv('EVIDENCE_EXPORT_TIMEOUT_MINUTES', '180');
});
afterAll(async () => {
  if (ctx) {
    await ctx.sql`delete from "EvidenceExports" where "DeviceId" = ${deviceId}`;
    await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
    await dropTestUsers(ctx.sql, [`${PREFIX}%`]);
    await ctx.close();
  }
  vi.unstubAllEnvs();
});

describe('EvidenceExportWorker.recoverOnStart', () => {
  it('enqueues every Queued row once (job id dedupes), skips other statuses', async () => {
    const queued = await insertExport(1, null, 1);
    const processing = await insertExport(2, 60_000, 2);
    await insertExport(3, null, 3);
    const add = vi.fn().mockResolvedValue({});
    const worker = new EvidenceExportWorker(db, { process: vi.fn() } as never, { add } as never);

    await worker.recoverOnStart();

    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][1]).toEqual({ exportId: String(queued) });
    expect(add.mock.calls[0][2]).toEqual({ jobId: `evidence-export-${queued}` });
    expect((await rowOf(queued)).Status).toBe(1);
    expect((await rowOf(processing)).Status).toBe(2);
  });

  it('Processing started 4 h ago (timeout 180 min) -> Failed; a fresh Processing row is untouched', async () => {
    const stale = await insertExport(2, 4 * 3_600_000, 1);
    const fresh = await insertExport(2, 5 * 60_000, 2);
    const worker = new EvidenceExportWorker(db, { process: vi.fn() } as never, { add: vi.fn() } as never);

    await worker.recoverOnStart();

    const staleRow = await rowOf(stale);
    expect(staleRow.Status).toBe(4);
    expect(staleRow.ErrorMessage).toBe('งานค้าง กรุณาสั่งใหม่');
    expect(staleRow.CompletedAt).toBeInstanceOf(Date);
    const freshRow = await rowOf(fresh);
    expect(freshRow.Status).toBe(2);
    expect(freshRow.ErrorMessage).toBeNull();
  });

  it('a queue that rejects does not stop recovery', async () => {
    const stale = await insertExport(2, 4 * 3_600_000, 1);
    await insertExport(1, null, 2);
    const worker = new EvidenceExportWorker(db, { process: vi.fn() } as never, { add: vi.fn().mockRejectedValue(new Error('redis down')) } as never);

    await expect(worker.recoverOnStart()).resolves.toBeUndefined();

    expect((await rowOf(stale)).Status).toBe(4);
  });

  it('no queue (REDIS_URL unset): still fails stale Processing rows', async () => {
    const stale = await insertExport(2, 4 * 3_600_000, 1);
    const worker = new EvidenceExportWorker(db, { process: vi.fn() } as never, null);

    await worker.recoverOnStart();

    expect((await rowOf(stale)).Status).toBe(4);
  });
});

describe('EvidenceExportWorker shutdown', () => {
  it('aborts a running export so its row ends Failed (not stuck in Processing)', async () => {
    vi.stubEnv('STREAM_ALLOWED_HOSTS', 'dss.local');
    const id = await insertExport(1, null, 1);
    const requestPlayback = vi.fn().mockResolvedValue({ vendorUrl: 'http://dss.local/p/stream.m3u8', vendorSessionId: 's' });
    const processor = new EvidenceExportProcessor(
      db,
      { requestPlayback } as unknown as RecordingProvider,
      new LiveStreamProvider(),
      ctx.app.get(SettingsService),
    );
    processor.mediaDeps = {
      ...processor.mediaDeps,
      // a download that never finishes, until the export is aborted
      fetchText: (_url, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    };
    const running = processor.process(id);
    await eventually(async () => (await rowOf(id)).Status === 2);

    await new EvidenceExportWorker(db, processor, null).beforeApplicationShutdown();
    await running;

    const row = await rowOf(id);
    expect(row.Status).toBe(4);
    expect(row.ErrorMessage).toBe('ระบบหยุดทำงานระหว่างแปลงไฟล์ กรุณาสั่งใหม่');
    expect(row.CompletedAt).toBeInstanceOf(Date);
  });
});

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { SettingsService } from '../../common/settings/settings.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { bootHttpContext, createTestUsers, dropTestUsers, type HttpContext } from '../../test/int-helpers';
import { LiveStreamProvider } from '../streaming/live-stream.provider';
import { RecordingProvider } from '../streaming/recording-provider';
import { evidenceExportEnv } from './evidence-export-env';
import { EvidenceExportProcessor } from './evidence-export.processor';
import { ExportFailure } from './evidence-export-failure';
import { remuxToMp4, type MediaDeps } from './evidence-media';

const PREFIX = 't_evp_';
const CODE = 'TEST-EVP-CAM';
const HOST = 'dss.local';
const PLAYLIST_URL = `http://${HOST}/proxy/evp/stream.m3u8`;

let ctx: HttpContext;
let db: DrizzleDB;
let storageDir: string;
let workDir: string;
let userId: bigint;
let deviceId: bigint;
let segmentBytes: Buffer[];
let realFfmpeg = false;

/** The real binary when it runs (dev machine, CI image); otherwise a fake remux that writes bytes. */
function probeFfmpeg(): boolean {
  const probe = spawnSync(evidenceExportEnv().ffmpegPath, ['-version'], { stdio: 'ignore', windowsHide: true });
  return probe.status === 0;
}

/** Two 1 s MPEG-TS segments generated with ffmpeg itself (continuous timestamps), no binary fixtures. */
function makeSegments(dir: string): Buffer[] {
  const result = spawnSync(
    evidenceExportEnv().ffmpegPath,
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=duration=2:size=64x64:rate=5',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '5',
      '-force_key_frames', 'expr:gte(t,n_forced*1)',
      '-f', 'segment', '-segment_time', '1', '-segment_format', 'mpegts',
      join(dir, 'seg%d.ts'),
    ],
    { windowsHide: true },
  );
  if (result.status !== 0) throw new Error(`ffmpeg could not generate test segments: ${String(result.stderr)}`);
  return [readFileSync(join(dir, 'seg0.ts')), readFileSync(join(dir, 'seg1.ts'))];
}

const PLAYLIST = [
  '#EXTM3U', '#EXT-X-TARGETDURATION:1', '#EXT-X-MEDIA-SEQUENCE:0',
  '#EXTINF:1,', 'seg0.ts', '#EXTINF:1,', 'seg1.ts', '#EXT-X-ENDLIST',
].join('\n');

function fakeMediaDeps(): MediaDeps {
  return {
    fetchText: () => Promise.resolve({ body: PLAYLIST, contentType: 'application/vnd.apple.mpegurl' }),
    fetchBytes: (url) => Promise.resolve(segmentBytes[url.endsWith('seg0.ts') ? 0 : 1]),
    sleep: () => Promise.resolve(),
    now: () => 0,
    assertAllowed: (url) => {
      new LiveStreamProvider().assertAllowed(url);
    },
  };
}

/** Stand-in for ffmpeg: writes the bytes it was given. */
const fakeRemux: typeof remuxToMp4 = async (input) => {
  const parts: Buffer[] = [];
  for (const seg of input.media.segments) parts.push(await input.deps.fetchBytes(seg.url, input.signal));
  writeFileSync(input.outFile, Buffer.concat([Buffer.from('....ftyp'), ...parts]));
  await input.onProgress(input.media.segments.length, input.media.segments.length);
};

const requestPlayback = vi.fn();
const makeProcessor = (): EvidenceExportProcessor => {
  const processor = new EvidenceExportProcessor(
    db,
    { requestPlayback } as unknown as RecordingProvider,
    new LiveStreamProvider(),
    ctx.app.get(SettingsService),
  );
  processor.mediaDeps = fakeMediaDeps();
  if (!realFfmpeg) processor.remux = fakeRemux;
  return processor;
};

const startAt = new Date('2026-11-20T03:00:00.000Z');
const insertExport = async (overrides: { start?: Date; status?: number } = {}): Promise<bigint> => {
  const start = overrides.start ?? startAt;
  const [row] = await ctx.sql`
    insert into "EvidenceExports" ("DeviceId", "StartAt", "EndAt", "Status", "RequestedBy")
    values (${deviceId}, ${start}, ${new Date(start.getTime() + 2000)}, ${overrides.status ?? 1}, ${userId})
    returning "Id"`;
  return row.Id as bigint;
};
const rowOf = async (id: bigint) => (await ctx.sql`select * from "EvidenceExports" where "Id" = ${id}`)[0];
const evidenceFiles = () => (existsSync(join(storageDir, 'evidence')) ? readdirSync(join(storageDir, 'evidence')) : []);
const setSetting = async (key: string, value: string) => {
  await ctx.sql`update "Settings" set "SettingValue" = ${value} where "SettingKey" = ${key}`;
  ctx.app.get(SettingsService).invalidate(key);
};

beforeAll(async () => {
  realFfmpeg = probeFfmpeg();
  storageDir = mkdtempSync(join(tmpdir(), 'evp-storage-'));
  workDir = mkdtempSync(join(tmpdir(), 'evp-seg-'));
  vi.stubEnv('STORAGE_LOCAL_DIR', storageDir);
  vi.stubEnv('STREAM_ALLOWED_HOSTS', HOST);
  segmentBytes = realFfmpeg ? makeSegments(workDir) : [Buffer.from('segment-0'), Buffer.from('segment-1')];
  ctx = await bootHttpContext();
  db = ctx.app.get<DrizzleDB>(DRIZZLE);
  await ctx.sql`delete from "EvidenceExports" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
  await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
  const ids = await createTestUsers(ctx.sql, [{ username: `${PREFIX}op`, role: 'OPERATOR' }], await hashPassword('Test@12345'));
  userId = ids.get(`${PREFIX}op`)!;
  const [device] = await ctx.sql`
    insert into "Devices" ("DeviceCode", "VendorDeviceId", "Name", "Kind") values (${CODE}, 'vendor-test-evp', 'Test export camera', 1)
    returning "Id"`;
  deviceId = device.Id as bigint;
});

beforeEach(async () => {
  requestPlayback.mockReset();
  requestPlayback.mockResolvedValue({ vendorUrl: PLAYLIST_URL, vendorSessionId: 'sess' });
  await ctx.sql`delete from "EvidenceExports" where "DeviceId" = ${deviceId}`;
  await ctx.sql`update "Devices" set "StreamingEnabled" = true, "Status" = 1, "IsDeleted" = false where "Id" = ${deviceId}`;
  await setSetting('streaming.enabled', 'true');
  rmSync(join(storageDir, 'evidence'), { recursive: true, force: true });
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
  rmSync(storageDir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

describe('EvidenceExportProcessor.process', () => {
  it('Queued -> Ready: file under evidence/, checksum of the file, Progress 100, no .part', async () => {
    const id = await insertExport();

    await makeProcessor().process(id);

    const row = await rowOf(id);
    expect(row.Status).toBe(3);
    expect(row.Progress).toBe(100);
    expect(row.ErrorMessage).toBeNull();
    expect(row.FileName).toBe('evidence_TEST-EVP-CAM_20261120-100000.mp4');
    expect(row.FilePath).toBe(`evidence/${row.FileName}`);
    const absolute = join(storageDir, row.FilePath as string);
    expect(existsSync(absolute)).toBe(true);
    const bytes = readFileSync(absolute);
    expect(row.Checksum).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(row.FileSizeBytes).toBe(BigInt(bytes.length));
    expect(row.MediaSeconds).toBe(2);
    expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');
    expect(evidenceFiles()).toEqual([row.FileName]);
    expect(row.CompletedAt).toBeInstanceOf(Date);
    expect((row.ExpiresAt as Date).getTime() - (row.CompletedAt as Date).getTime()).toBe(24 * 3_600_000);
    expect(row.StartedAt).toBeInstanceOf(Date);
    expect(requestPlayback).toHaveBeenCalledTimes(1);
    expect(requestPlayback.mock.calls[0][0]).toBe('vendor-test-evp');
    expect(requestPlayback.mock.calls[0][1]).toEqual(startAt);
  });

  it('a second export with the same start keeps both files (export id added to the name)', async () => {
    const first = await insertExport();
    const second = await insertExport();
    const processor = makeProcessor();

    await processor.process(first);
    await processor.process(second);

    const a = await rowOf(first);
    const b = await rowOf(second);
    expect(a.FileName).not.toBe(b.FileName);
    expect(b.FileName).toContain(String(second));
    expect(b.FilePath).toBe(`evidence/${b.FileName}`);
    expect(evidenceFiles().sort()).toEqual([a.FileName, b.FileName].sort());
  });

  it("'no-recordings' -> Failed with the Thai reason, no file", async () => {
    requestPlayback.mockResolvedValue('no-recordings');
    const id = await insertExport();

    await makeProcessor().process(id);

    const row = await rowOf(id);
    expect(row.Status).toBe(4);
    expect(row.ErrorMessage).toBe('ไม่พบไฟล์บันทึกในช่วงเวลานี้');
    expect(row.FilePath).toBeNull();
    expect(evidenceFiles()).toEqual([]);
  });

  it('vendor failure -> Failed with a generic Thai message (no vendor text)', async () => {
    requestPlayback.mockRejectedValue(new Error('DSS playback request returned HTTP 502 http://dss.local/?token=secret'));
    const id = await insertExport();

    await makeProcessor().process(id);

    const row = await rowOf(id);
    expect(row.Status).toBe(4);
    expect(row.ErrorMessage).not.toContain('secret');
    expect(row.ErrorMessage).not.toContain('DSS');
    expect(row.ErrorMessage).toMatch(/[฀-๿]/);
  });

  it('device deleted while queued -> Failed, the vendor is never asked', async () => {
    const id = await insertExport();
    await ctx.sql`update "Devices" set "IsDeleted" = true where "Id" = ${deviceId}`;

    await makeProcessor().process(id);

    const row = await rowOf(id);
    expect(row.Status).toBe(4);
    expect(row.ErrorMessage).toBe('อุปกรณ์ถูกลบจากระบบแล้ว');
    expect(requestPlayback).not.toHaveBeenCalled();
  });

  it('StreamingEnabled turned off while queued -> Failed', async () => {
    const id = await insertExport();
    await ctx.sql`update "Devices" set "StreamingEnabled" = false where "Id" = ${deviceId}`;

    await makeProcessor().process(id);

    const row = await rowOf(id);
    expect(row.Status).toBe(4);
    expect(row.ErrorMessage).toBe('ผู้ดูแลปิดการดูภาพของกล้องตัวนี้แล้ว');
    expect(requestPlayback).not.toHaveBeenCalled();
  });

  it('streaming.enabled = false at run time -> Failed', async () => {
    const id = await insertExport();
    await setSetting('streaming.enabled', 'false');

    await makeProcessor().process(id);

    const row = await rowOf(id);
    expect(row.Status).toBe(4);
    expect(row.ErrorMessage).toBe('ระบบปิดการดูวิดีโอไว้');
    expect(requestPlayback).not.toHaveBeenCalled();
  });

  it('a retired camera continues (its recordings stay exportable)', async () => {
    const id = await insertExport();
    await ctx.sql`update "Devices" set "Status" = 4 where "Id" = ${deviceId}`;

    await makeProcessor().process(id);

    expect((await rowOf(id)).Status).toBe(3);
  });

  it('a row that is not Queued is skipped untouched', async () => {
    const processing = await insertExport({ status: 2 });
    const ready = await insertExport({ start: new Date(startAt.getTime() + 60_000), status: 3 });
    const processor = makeProcessor();

    await processor.process(processing);
    await processor.process(ready);
    await processor.process(999_999_999n);

    expect((await rowOf(processing)).Status).toBe(2);
    expect((await rowOf(ready)).Status).toBe(3);
    expect(requestPlayback).not.toHaveBeenCalled();
  });

  it('runs past EVIDENCE_EXPORT_TIMEOUT_MINUTES -> Failed and leaves no files', async () => {
    vi.stubEnv('EVIDENCE_EXPORT_TIMEOUT_MINUTES', '0.0005'); // 30 ms
    const id = await insertExport();
    const processor = makeProcessor();
    processor.mediaDeps = {
      ...fakeMediaDeps(),
      fetchText: (_url, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    };

    await processor.process(id);

    const row = await rowOf(id);
    expect(row.Status).toBe(4);
    expect(row.ErrorMessage).toContain('นานเกิน');
    expect(evidenceFiles()).toEqual([]);
  });

  it('a playlist URL outside the allowed host fails the export', async () => {
    requestPlayback.mockResolvedValue({ vendorUrl: 'http://evil.example/stream.m3u8', vendorSessionId: 's' });
    const id = await insertExport();

    await makeProcessor().process(id);

    expect((await rowOf(id)).Status).toBe(4);
  });

  it('ErrorMessage is the short Thai summary: no ffmpeg stderr, temp path, exit code or FFMPEG_PATH text', async () => {
    const id = await insertExport();
    const processor = makeProcessor();
    processor.remux = () =>
      Promise.reject(
        new ExportFailure('แปลงไฟล์ไม่สำเร็จ', 'ffmpeg exit 1: C:\\Users\\x\\Temp\\out.mp4 Invalid data found; FFMPEG_PATH=C:\\ffmpeg'),
      );

    await processor.process(id);

    const row = await rowOf(id);
    expect(row.Status).toBe(4);
    expect(row.ErrorMessage).toBe('แปลงไฟล์ไม่สำเร็จ');
    expect(row.ErrorMessage).not.toMatch(/ffmpeg|Temp|exit|Invalid|FFMPEG/i);
  });

  it('a store-phase failure removes the .part, leaves a pre-existing final-name file alone, row Failed', async () => {
    const id = await insertExport();
    const dir = join(storageDir, 'evidence');
    mkdirSync(dir, { recursive: true });
    const name = 'evidence_TEST-EVP-CAM_20261120-100000.mp4';
    writeFileSync(join(dir, name), 'someone-elses-file'); // forces the "_<id>" name ...
    const blocked = join(dir, `evidence_TEST-EVP-CAM_20261120-100000_${id}.mp4`);
    mkdirSync(blocked); // ... which is a non-empty directory, so rename fails
    writeFileSync(join(blocked, 'blocker'), 'x');

    await makeProcessor().process(id);

    const row = await rowOf(id);
    expect(row.Status).toBe(4);
    expect(row.FilePath).toBeNull();
    expect(readFileSync(join(dir, name), 'utf8')).toBe('someone-elses-file');
    expect(evidenceFiles().filter((f) => f.endsWith('.part'))).toEqual([]);
  });
});

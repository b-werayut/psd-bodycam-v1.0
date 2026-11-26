import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { copyFile, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService } from '../../common/settings/settings.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Devices, EvidenceExports } from '../../db/schema';
import { LiveStreamProvider } from '../streaming/live-stream.provider';
import { RecordingProvider } from '../streaming/recording-provider';
import { evidenceExportEnv } from './evidence-export-env';
import { ExportFailure, logSafe } from './evidence-export-failure';
import { EVIDENCE_EXPORT_STATUS, EXPORT_TTL_MS, exportFileName, segmentProgress } from './evidence-export-rules';
import { evidenceStorage } from './evidence-storage';
import {
  collectSegments,
  defaultMediaDeps,
  fileDigest,
  playbackRequestEnd,
  remuxToMp4,
  type MediaDeps,
} from './evidence-media';
import { coveredSeconds } from './hls-playlist';

const PROGRESS_WRITE_INTERVAL_MS = 2000;
const GENERIC_FAILURE = 'แปลงไฟล์ไม่สำเร็จ';
const THAI = /[฀-๿]/;

export const SHUTDOWN_MESSAGE = 'ระบบหยุดทำงานระหว่างแปลงไฟล์ กรุณาสั่งใหม่';

/**
 * Only an `ExportFailure` (short Thai text written by this code) reaches the user. Anything else
 * (vendor / driver / system errors, which can carry URLs with tokens) becomes a generic Thai message.
 */
function userMessage(error: unknown): string {
  return error instanceof ExportFailure && THAI.test(error.message) ? error.message.slice(0, 500) : GENERIC_FAILURE;
}

/** English log text for a failure: the detail (never shown to the user) with URLs masked. */
function logReason(error: unknown): string {
  const raw = error instanceof ExportFailure ? (error.detail ?? '') : error instanceof Error ? error.message : '';
  return raw ? `: ${logSafe(raw)}` : '';
}

/**
 * Turns one Queued export into an MP4: DSS playback HLS -> segments -> ffmpeg (remux, no re-encode) -> storage.
 * Worker role `media` only (BullMQ calls it; tests call it directly). A row that is not Queued is skipped.
 */
@Injectable()
export class EvidenceExportProcessor {
  private readonly logger = new Logger(EvidenceExportProcessor.name);
  /** Tests replace these two; the defaults are the real network and the real ffmpeg. */
  mediaDeps: MediaDeps;
  remux: typeof remuxToMp4 = remuxToMp4;
  private readonly active = new Map<bigint, AbortController>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly recordings: RecordingProvider,
    private readonly live: LiveStreamProvider,
    private readonly settings: SettingsService,
  ) {
    this.mediaDeps = { ...defaultMediaDeps, assertAllowed: (url) => void this.live.assertAllowed(url) };
  }

  /**
   * Aborts every running export (kills its ffmpeg); each one then records Failed with this reason.
   * Called on shutdown while the DB pool is still open, so no row is left in Processing.
   */
  abortActive(reason: string = SHUTDOWN_MESSAGE): void {
    for (const controller of this.active.values()) controller.abort(new ExportFailure(reason, 'aborted by shutdown'));
  }

  async process(exportId: bigint): Promise<void> {
    const [claimed] = await this.db
      .update(EvidenceExports)
      .set({ Status: EVIDENCE_EXPORT_STATUS.PROCESSING, StartedAt: new Date(), Progress: 0 })
      .where(and(eq(EvidenceExports.Id, exportId), eq(EvidenceExports.Status, EVIDENCE_EXPORT_STATUS.QUEUED)))
      .returning();
    if (!claimed) {
      this.logger.warn(`Skipping evidence export ${exportId}: not Queued`);
      return;
    }

    const { ffmpegPath, timeoutMs, timeoutMinutes } = evidenceExportEnv();
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new ExportFailure(`แปลงไฟล์นานเกิน ${Math.max(1, Math.round(timeoutMinutes))} นาที จึงยกเลิก`, `export timed out after ${timeoutMinutes} minutes`)),
      timeoutMs,
    );
    timer.unref();
    this.active.set(exportId, controller);
    let partPath: string | null = null;
    let tempDir: string | null = null;
    let storedAbsolute: string | null = null;
    let phase = 'device';

    try {
      const [device] = await this.db
        .select({
          deviceCode: Devices.DeviceCode,
          vendorDeviceId: Devices.VendorDeviceId,
          streamingEnabled: Devices.StreamingEnabled,
          isDeleted: Devices.IsDeleted,
        })
        .from(Devices)
        .where(eq(Devices.Id, claimed.DeviceId))
        .limit(1);
      // Checked again at run time: the camera or the whole feature may have been switched off while queued.
      // A retired camera is allowed: its recordings stay exportable.
      if (!device || device.isDeleted) throw new ExportFailure('อุปกรณ์ถูกลบจากระบบแล้ว', 'device missing or deleted');
      if (!device.streamingEnabled) throw new ExportFailure('ผู้ดูแลปิดการดูภาพของกล้องตัวนี้แล้ว', 'streaming disabled for the device');
      if (!(await this.settings.getBool('streaming.enabled'))) throw new ExportFailure('ระบบปิดการดูวิดีโอไว้', 'streaming.enabled is off');

      phase = 'playback';
      // Asked past the end of the range; collectSegments keeps only what covers it (PLAYBACK_TAIL_PAD_SECONDS).
      const ticket = await this.recordings.requestPlayback(
        device.vendorDeviceId,
        claimed.StartAt,
        playbackRequestEnd(claimed.EndAt, new Date()),
      );
      if (ticket === 'no-recordings') throw new ExportFailure('ไม่พบไฟล์บันทึกในช่วงเวลานี้', 'no recordings in range');

      phase = 'collect';
      const requestedSeconds = (claimed.EndAt.getTime() - claimed.StartAt.getTime()) / 1000;
      const media = await collectSegments(ticket.vendorUrl, requestedSeconds, this.mediaDeps, controller.signal);

      phase = 'remux';
      tempDir = await mkdtemp(join(tmpdir(), 'bodycam-evidence-'));
      const outFile = join(tempDir, 'out.mp4');
      let lastWrite = 0;
      let lastPercent = -1;
      await this.remux({
        media,
        outFile,
        ffmpegPath,
        deps: this.mediaDeps,
        signal: controller.signal,
        onProgress: async (done, total) => {
          const percent = segmentProgress(done, total);
          const now = Date.now();
          if (percent === lastPercent || (now - lastWrite < PROGRESS_WRITE_INTERVAL_MS && done < total)) return;
          lastPercent = percent;
          lastWrite = now;
          await this.db.update(EvidenceExports).set({ Progress: percent }).where(eq(EvidenceExports.Id, exportId));
        },
      });

      phase = 'store';
      const digest = await fileDigest(outFile);
      const fileName = exportFileName({ deviceCode: device.deviceCode, startAt: claimed.StartAt });
      const storage = evidenceStorage();
      const dir = storage.evidenceDir();
      await mkdir(dir, { recursive: true });
      // Copy to <name>.part, then rename: a reader or the cleanup never sees a half-written final file.
      // The id keeps concurrent exports from sharing one .part.
      const part = join(dir, `${fileName}.${exportId}.part`);
      partPath = part;
      await copyFile(outFile, part);
      const finalName = (await exists(join(dir, fileName)))
        ? fileName.replace(/\.mp4$/, `_${exportId}.mp4`)
        : fileName;
      const finalAbsolute = join(dir, finalName);
      await rename(part, finalAbsolute);
      partPath = null;
      storedAbsolute = finalAbsolute; // set only once it is ours: a failed rename must not delete someone else's file

      const completedAt = new Date();
      const [updated] = await this.db
        .update(EvidenceExports)
        .set({
          Status: EVIDENCE_EXPORT_STATUS.READY,
          Progress: 100,
          FilePath: `evidence/${finalName}`,
          FileName: finalName,
          FileSizeBytes: BigInt(digest.size),
          Checksum: digest.sha256,
          MediaSeconds: Math.round(coveredSeconds(media.segments)),
          CompletedAt: completedAt,
          ExpiresAt: new Date(completedAt.getTime() + EXPORT_TTL_MS),
        })
        .where(and(eq(EvidenceExports.Id, exportId), eq(EvidenceExports.Status, EVIDENCE_EXPORT_STATUS.PROCESSING)))
        .returning({ id: EvidenceExports.Id });
      if (!updated) {
        // Recovery closed this row while we worked: no row points at the file any more.
        await rm(storedAbsolute, { force: true }).catch(() => undefined);
        storedAbsolute = null;
      }
      this.logger.log(`Evidence export ${exportId} ready (${media.segments.length} segments, ${digest.size} bytes)`);
    } catch (error) {
      // English log, never the message: vendor errors can carry URLs with tokens.
      this.logger.error(
        `Evidence export ${exportId} failed at '${phase}' (${error instanceof Error ? error.name : 'error'})${logReason(error)}`,
      );
      if (partPath) await rm(partPath, { force: true }).catch(() => undefined);
      if (storedAbsolute) await rm(storedAbsolute, { force: true }).catch(() => undefined);
      await this.db
        .update(EvidenceExports)
        .set({ Status: EVIDENCE_EXPORT_STATUS.FAILED, ErrorMessage: userMessage(error), CompletedAt: new Date() })
        .where(and(eq(EvidenceExports.Id, exportId), eq(EvidenceExports.Status, EVIDENCE_EXPORT_STATUS.PROCESSING)))
        .catch((dbError: unknown) =>
          this.logger.error(`Could not record failure of evidence export ${exportId} (${dbError instanceof Error ? dbError.name : 'error'})`),
        );
    } finally {
      clearTimeout(timer);
      this.active.delete(exportId);
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, eq, lte } from 'drizzle-orm';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { EvidenceExports } from '../../db/schema';
import { evidenceExportEnv } from './evidence-export-env';
import { failStuckProcessing } from './evidence-export-recovery';
import { EVIDENCE_EXPORT_STATUS } from './evidence-export-rules';
import { evidenceStorage } from './evidence-storage';

export const EVIDENCE_CLEANUP_INTERVAL_MS = 60_000;
/** A `.part` this old belongs to a worker that died mid-copy. */
export const STALE_PART_MS = 3_600_000;
/** Grace after the export timeout before a Processing row counts as stuck (its own timeout fires first). */
export const STUCK_GRACE_MS = 5 * 60_000;

/**
 * Worker role `media`: every minute expires Ready exports past `ExpiresAt` (file deleted, row -> Expired),
 * fails Processing rows older than timeout + 5 min, and removes `evidence/*.part` left by a crash. Safe to run in several workers: each step is idempotent.
 */
@Injectable()
export class EvidenceCleanupJob implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger(EvidenceCleanupJob.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running: Promise<unknown> | null = null;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  onApplicationBootstrap(): void {
    this.schedule(0);
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  /** Returns how many exports became Expired. */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const storage = evidenceStorage();
    const due = await this.db
      .select({ id: EvidenceExports.Id, filePath: EvidenceExports.FilePath })
      .from(EvidenceExports)
      .where(and(eq(EvidenceExports.Status, EVIDENCE_EXPORT_STATUS.READY), lte(EvidenceExports.ExpiresAt, now)));

    let expired = 0;
    for (const row of due) {
      if (row.filePath) {
        let absolute: string | null = null;
        try {
          absolute = storage.absolute(row.filePath);
        } catch {
          // A path outside the root is never deleted; the row still expires.
          this.logger.warn(`Evidence export ${row.id} has a stored path outside the storage root - file left alone`);
        }
        if (absolute) {
          try {
            await rm(absolute, { force: true }); // force: a missing file is fine
          } catch (error) {
            // Keep Ready so the next round retries; never mark Expired while the file may still exist.
            this.logger.warn(
              `Could not delete file of evidence export ${row.id}: ${(error as NodeJS.ErrnoException).code ?? 'error'}`,
            );
            continue;
          }
        }
      }
      const result = await this.db
        .update(EvidenceExports)
        .set({ Status: EVIDENCE_EXPORT_STATUS.EXPIRED })
        .where(and(eq(EvidenceExports.Id, row.id), eq(EvidenceExports.Status, EVIDENCE_EXPORT_STATUS.READY)))
        .returning({ id: EvidenceExports.Id });
      expired += result.length;
    }

    // A worker that died mid-export leaves a Processing row that blocks the same range from being asked again.
    const stuck = await failStuckProcessing(this.db, new Date(now.getTime() - evidenceExportEnv().timeoutMs - STUCK_GRACE_MS));
    if (stuck.length) this.logger.warn(`Failed ${stuck.length} evidence export(s) stuck in Processing`);

    await this.removeStaleParts(storage.evidenceDir(), now);
    return expired;
  }

  private async removeStaleParts(dir: string, now: Date): Promise<void> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return; // no evidence directory yet
    }
    for (const name of names) {
      if (!name.endsWith('.part')) continue;
      const path = join(dir, name);
      try {
        const info = await stat(path);
        if (info.isFile() && now.getTime() - info.mtimeMs > STALE_PART_MS) await rm(path, { force: true });
      } catch {
        // gone already, or busy: the next round looks again
      }
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.purgeExpired()
        .catch((error: unknown) =>
          this.logger.warn(`Evidence cleanup failed (will retry): ${error instanceof Error ? error.name : 'error'}`),
        )
        .finally(() => {
          this.running = null;
          this.schedule(EVIDENCE_CLEANUP_INTERVAL_MS);
        });
    }, delayMs);
    this.timer.unref();
  }

  private async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }
}

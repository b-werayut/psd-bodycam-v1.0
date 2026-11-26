import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker, type Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { spawn } from 'node:child_process';
import type IORedis from 'ioredis';
import { EVIDENCE_EXPORT, queueConnection, queuePrefix, type EvidenceExportJob } from '../../common/queue/queue.constants';
import { EVIDENCE_EXPORT_QUEUE } from '../../common/queue/queue.module';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { EvidenceExports } from '../../db/schema';
import { evidenceExportEnv } from './evidence-export-env';
import { failStuckProcessing } from './evidence-export-recovery';
import { EVIDENCE_EXPORT_STATUS } from './evidence-export-rules';
import { EvidenceExportProcessor } from './evidence-export.processor';

/** Shutdown waits this long for a running export; a row cut off stays Processing and recovery fails it later. */
const CLOSE_TIMEOUT_MS = 10_000;
/** Exports run for minutes: the lock is renewed by BullMQ while the event loop is free. */
const LOCK_DURATION_MS = 120_000;

/**
 * Worker role `media`: consumes `evidence-export` (`{ exportId }`, added by the api after commit).
 * The queue only wakes the processor up (it ignores the job name); the DB row is the state.
 * On start `recoverOnStart` re-enqueues Queued rows the queue lost and fails Processing rows that never finished.
 *
 * Stops in `beforeApplicationShutdown`, before Nest closes the DB pool: it first aborts running exports (kills their
 * ffmpeg), which then record Failed "ระบบหยุดทำงาน..." while the pool is still open, then closes the BullMQ worker.
 */
@Injectable()
export class EvidenceExportWorker implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger(EvidenceExportWorker.name);
  private worker: Worker<EvidenceExportJob> | null = null;
  private connection: IORedis | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly processor: EvidenceExportProcessor,
    @Inject(EVIDENCE_EXPORT_QUEUE) private readonly queue: Queue<EvidenceExportJob> | null,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const env = evidenceExportEnv();
    this.checkFfmpeg(env.ffmpegPath);
    const url = (process.env.REDIS_URL ?? '').trim();
    if (!url) {
      this.logger.warn('REDIS_URL is not set - evidence-export queue not started');
    } else {
      const connection = queueConnection(url, 'worker');
      // Without a listener ioredis would print every reconnect error unhandled.
      connection.on('error', (err) => this.logger.warn(`evidence-export queue Redis: ${err.message}`));
      this.connection = connection;
      const worker = new Worker<EvidenceExportJob>(
        EVIDENCE_EXPORT,
        (job) => this.processor.process(BigInt(job.data.exportId)),
        { connection, prefix: queuePrefix(), concurrency: env.concurrency, lockDuration: LOCK_DURATION_MS },
      );
      worker.on('error', (err) => this.logger.warn(`evidence-export queue: ${err.message}`));
      // The processor records its own failures in the row; this only fires for a bad job or an unreachable DB.
      worker.on('failed', (job, err) => this.logger.warn(`evidence-export job ${job?.id ?? '?'} failed: ${err.name}`));
      this.worker = worker;
    }
    await this.recoverOnStart().catch((err: unknown) =>
      this.logger.warn(`Evidence export recovery failed: ${err instanceof Error ? err.name : 'error'}`),
    );
  }

  /**
   * - a Processing row whose `StartedAt` is older than the timeout can never finish: Failed, the user presses download again;
   * - every Queued row is added to the queue again (the job id `evidence-export-{Id}` makes an existing job a no-op).
   */
  async recoverOnStart(): Promise<void> {
    const { timeoutMs } = evidenceExportEnv();
    const stale = await failStuckProcessing(this.db, new Date(Date.now() - timeoutMs));
    if (stale.length) this.logger.warn(`Failed ${stale.length} evidence export(s) stuck in Processing`);

    if (!this.queue) return;
    const queued = await this.db
      .select({ id: EvidenceExports.Id })
      .from(EvidenceExports)
      .where(eq(EvidenceExports.Status, EVIDENCE_EXPORT_STATUS.QUEUED))
      .orderBy(EvidenceExports.Id);
    for (const { id } of queued) {
      try {
        await this.queue.add('export', { exportId: String(id) }, { jobId: `evidence-export-${id}` });
      } catch (err) {
        this.logger.warn(`Could not re-enqueue evidence export ${id}: ${err instanceof Error ? err.name : 'error'}`);
      }
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  /** Fallback (idempotent) for a context closed without the before-shutdown phase. */
  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  isRunning(): boolean {
    return this.worker !== null;
  }

  /** Warns at boot: without ffmpeg every export fails, better found now than by the first user. */
  private checkFfmpeg(path: string): void {
    const probe = spawn(path, ['-version'], { stdio: 'ignore', windowsHide: true });
    probe.on('error', () => {
      this.logger.error(`ffmpeg not found ('${path}') - every MP4 export will fail. Install ffmpeg or set FFMPEG_PATH`);
    });
  }

  private async stop(): Promise<void> {
    const { worker, connection } = this;
    this.worker = null;
    this.connection = null;
    // Abort first: close() would wait for exports that run for minutes, and after the pool closes they could not write their result.
    this.processor.abortActive();
    if (worker) {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), CLOSE_TIMEOUT_MS);
      });
      const result = await Promise.race([worker.close().catch(() => undefined), timeout]);
      clearTimeout(timer);
      if (result === 'timeout') {
        this.logger.warn(`Closing evidence-export queue did not finish in ${CLOSE_TIMEOUT_MS} ms - disconnecting`);
      }
    }
    connection?.disconnect();
  }
}

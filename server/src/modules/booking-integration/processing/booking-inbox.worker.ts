import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { BOOKING_INBOX, queueConnection, queuePrefix, type BookingInboxJob } from '../../../common/queue/queue.constants';
import { safeErrorSummary } from '../inbound/inbound-call-log.service';
import { BookingInboxProcessor, type InboxOutcome } from './booking-inbox.processor';

export const BOOKING_INBOX_CONCURRENCY = 4;
/** Shutdown waits this long for running jobs; a row cut off stays Pending / Failed for the retry sweep. */
const CLOSE_TIMEOUT_MS = 10_000;

/**
 * Worker role `integration`: consumes `booking-inbox` (`{ inboxId }`, enqueued by the api after commit).
 * The queue only wakes the processor up; the inbox row is the state. Retries come from the retry sweep,
 * not BullMQ attempts. No REDIS_URL ⇒ not started (the sweep still processes rows from the DB).
 *
 * Stops in `beforeApplicationShutdown`: Nest runs `onApplicationShutdown` deepest module first, so the DB
 * pool (`DbModule`, imported through AppModule) would close before this module and fail the running jobs.
 */
@Injectable()
export class BookingInboxWorker implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger(BookingInboxWorker.name);
  private worker: Worker<BookingInboxJob, InboxOutcome> | null = null;
  private connection: IORedis | null = null;

  constructor(private readonly processor: BookingInboxProcessor) {}

  onApplicationBootstrap(): void {
    const url = (process.env.REDIS_URL ?? '').trim();
    if (!url) {
      this.logger.warn('ไม่ได้ตั้ง REDIS_URL — ไม่เปิดคิว booking-inbox');
      return;
    }
    const connection = queueConnection(url, 'worker');
    // Without a listener ioredis would print every reconnect error unhandled.
    connection.on('error', (err) => this.logger.warn(`Redis ของคิว booking-inbox: ${err.message}`));
    this.connection = connection;

    const worker = new Worker<BookingInboxJob, InboxOutcome>(
      BOOKING_INBOX,
      (job) => this.processor.process(BigInt(job.data.inboxId)),
      { connection, prefix: queuePrefix(), concurrency: BOOKING_INBOX_CONCURRENCY },
    );
    worker.on('error', (err) => this.logger.warn(`คิว booking-inbox: ${err.message}`));
    // only when the DB could not even record the failure (or a bad job id); the row is left for the sweep
    worker.on('failed', (job, err) =>
      this.logger.warn(`งาน ${job?.id ?? '?'} ของคิว booking-inbox ไม่สำเร็จ: ${safeErrorSummary(err)}`),
    );
    this.worker = worker;
  }

  /** Stops taking jobs and lets running ones finish while the DB pool is still open. */
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

  private async stop(): Promise<void> {
    const { worker, connection } = this;
    this.worker = null;
    this.connection = null;
    if (worker) {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), CLOSE_TIMEOUT_MS);
      });
      const result = await Promise.race([worker.close().catch(() => undefined), timeout]);
      clearTimeout(timer);
      if (result === 'timeout') this.logger.warn(`ปิดคิว booking-inbox ไม่เสร็จใน ${CLOSE_TIMEOUT_MS} ms — ตัดการเชื่อมต่อ`);
    }
    connection?.disconnect();
  }
}

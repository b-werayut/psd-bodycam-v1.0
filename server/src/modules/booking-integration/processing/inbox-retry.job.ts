import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, eq, lt, or } from 'drizzle-orm';
import type { RedisClientType } from 'redis';
import { RedisLockService } from '../../../common/lock/redis-lock.service';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { DRIZZLE } from '../../../db/db.constants';
import type { DrizzleDB } from '../../../db/db.types';
import { IntegrationInbox } from '../../../db/schema';
import { safeErrorSummary } from '../inbound/inbound-call-log.service';
import { BookingInboxProcessor } from './booking-inbox.processor';

export const INBOX_RETRY_INTERVAL_MS = 300_000;
/** A Pending row younger than this is still the queue's; older ones were missed (or their worker died). */
export const INBOX_PENDING_GRACE_MS = 60_000;
export const INBOX_RETRY_BATCH = 200;
const LEASE_KEY = 'booking:inbox-retry';
const LEASE_TTL_SECONDS = 300;
const INBOX = { PENDING: 1, FAILED: 3 } as const;

/**
 * Worker role `integration` (design §4.4): every 5 minutes, and once at start, picks Pending rows the queue
 * missed plus Failed rows straight from the DB (no BullMQ, so it works with Redis down) and runs
 * `BookingInboxProcessor.process` on them one by one. Duplicate runs are harmless: the processor takes
 * `FOR UPDATE SKIP LOCKED` on each row.
 *
 * Stops in `beforeApplicationShutdown` so a running sweep does not hit a DB pool that Nest already closed.
 */
@Injectable()
export class InboxRetryJob implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger(InboxRetryJob.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running: Promise<void> | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly processor: BookingInboxProcessor,
    private readonly lock: RedisLockService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType | null,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule(0);
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  /** Returns how many rows it picked. Candidate ids come from a plain, non-locking select. */
  async runOnce(now: Date): Promise<number> {
    const rows = await this.db
      .select({ id: IntegrationInbox.Id })
      .from(IntegrationInbox)
      .where(
        or(
          and(
            eq(IntegrationInbox.Status, INBOX.PENDING),
            lt(IntegrationInbox.ReceivedAt, new Date(now.getTime() - INBOX_PENDING_GRACE_MS)),
          ),
          eq(IntegrationInbox.Status, INBOX.FAILED),
        ),
      )
      .orderBy(asc(IntegrationInbox.ReceivedAt), asc(IntegrationInbox.Id))
      .limit(INBOX_RETRY_BATCH);

    for (const { id } of rows) {
      if (this.stopped) break;
      try {
        await this.processor.process(id, now);
      } catch (err) {
        this.logger.warn(`ลองประมวลผลแถว inbox ${id} ซ้ำไม่สำเร็จ: ${safeErrorSummary(err)}`);
      }
    }
    return rows.length;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.sweep().finally(() => {
        this.running = null;
        this.schedule(INBOX_RETRY_INTERVAL_MS);
      });
    }, delayMs);
    this.timer.unref();
  }

  private async sweep(): Promise<void> {
    try {
      const run = () => this.runOnce(new Date());
      // Redis not ready (down or not configured): sweep without a lease; SKIP LOCKED prevents double work.
      // Redis ready: `withLock` returning null then means another instance holds the lease.
      if (!this.redis?.isReady) await run();
      else await this.lock.withLock(LEASE_KEY, LEASE_TTL_SECONDS, run);
    } catch (err) {
      this.logger.warn(`retry sweep ของ inbox ไม่สำเร็จ (ลองใหม่รอบถัดไป): ${safeErrorSummary(err)}`);
    }
  }

  private async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }
}

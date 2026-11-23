import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { RedisLockService } from '../../common/lock/redis-lock.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { monthlyPartitionsAhead, partitionName } from '../../db/partitions';

/** Partitioned tables and their partition key (constants only — used as raw identifiers). */
const PARTITIONED = [
  { table: 'GpsLocations', key: 'RecordedAt' },
  { table: 'AuditLogs', key: 'OccurredAt' },
] as const;

const MONTHS_AHEAD = 2;
const LOCK_KEY = 'partition:maintenance';
const LOCK_TTL_SECONDS = 300;
export const PARTITION_MAINTENANCE_INTERVAL_MS = 24 * 3_600_000;

/**
 * Creates next months' partitions ahead (current + 2, idempotent). A `_default` partition that already
 * holds rows of a month makes `PARTITION OF` fail, so that month is reported as blocked and logged —
 * running daily keeps `_default` empty. Dropping old months (retention) is P6.
 */
@Injectable()
export class PartitionMaintenanceJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PartitionMaintenanceJob.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly lock: RedisLockService,
  ) {}

  onApplicationBootstrap(): void {
    void this.loop();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** null = no lock (another worker runs it, or Redis is down). */
  runOnce(now: Date = new Date()): Promise<{ created: string[]; blocked: string[] } | null> {
    return this.lock.withLock(LOCK_KEY, LOCK_TTL_SECONDS, () => this.ensure(now));
  }

  private async ensure(now: Date): Promise<{ created: string[]; blocked: string[] }> {
    const created: string[] = [];
    const blocked: string[] = [];
    for (const { table, key } of PARTITIONED) {
      for (const month of monthlyPartitionsAhead(now, MONTHS_AHEAD)) {
        const name = partitionName(table, month.suffix);
        const found = await this.db.execute(sql`select 1 from pg_class where relname = ${name}`);
        if (found.length > 0) continue;

        const stray = await this.db.execute(
          sql`select 1 from ${sql.identifier(`${table}_default`)}
              where ${sql.identifier(key)} >= ${month.from}::timestamptz and ${sql.identifier(key)} < ${month.to}::timestamptz
              limit 1`,
        );
        if (stray.length > 0) {
          blocked.push(name);
          this.logger.error(
            `สร้าง partition ${name} ไม่ได้: ${table}_default มีแถวของเดือนนั้นอยู่แล้ว — ` +
              `ย้ายแถวออกจาก ${table}_default ก่อน แล้วรันงานนี้ใหม่`,
          );
          continue;
        }
        await this.db.execute(
          sql`create table if not exists ${sql.identifier(name)} partition of ${sql.identifier(table)}
              for values from (${sql.raw(`'${month.from}'`)}) to (${sql.raw(`'${month.to}'`)})`,
        );
        created.push(name);
      }
    }
    if (created.length > 0) this.logger.log(`สร้าง partition ล่วงหน้า: ${created.join(', ')}`);
    return { created, blocked };
  }

  private async loop(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.logger.error(`PartitionMaintenance ไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.loop(), PARTITION_MAINTENANCE_INTERVAL_MS);
    this.timer.unref();
  }
}

import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { RedisClientType } from 'redis';
import { Public } from './common/auth/public.decorator';
import { AppException } from './common/errors/app-exception';
import { REDIS_CLIENT } from './common/redis/redis.module';
import { DRIZZLE } from './db/db.constants';
import type { DrizzleDB } from './db/db.types';

const CHECK_TIMEOUT_MS = 3000;

/** Liveness (/health) and dependency probes (/health/db, /health/redis) for k8s and the dev runbook. */
@Controller()
export class AppController {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType | null,
  ) {}

  @Public()
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public()
  @Get('health/db')
  async healthDb(): Promise<{ status: 'ok' }> {
    await probe('PostgreSQL', () => this.db.execute(sql`select 1`));
    return { status: 'ok' };
  }

  /** 503 when Redis is down — the app still works (login, refresh), only cross-process features degrade. */
  @Public()
  @Get('health/redis')
  async healthRedis(): Promise<{ status: 'ok' }> {
    await probe('Redis', async () => {
      if (!this.redis?.isReady) throw new Error('not connected');
      await this.redis.ping();
    });
    return { status: 'ok' };
  }
}

async function probe(name: string, check: () => Promise<unknown>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
  } catch {
    throw new AppException(503, 'SERVICE_UNAVAILABLE', `${name} ไม่พร้อมใช้งาน`);
  } finally {
    clearTimeout(timer);
  }
}

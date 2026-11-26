import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { closeRedis, openOptionalRedis } from './redis-connect';

/** Shared Redis client (`RedisClientType | null`). null = REDIS_URL not set. Check `isReady` on every use. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClientType | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.client) await closeRedis(this.client);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () =>
        openOptionalRedis(new Logger('Redis'), {
          label: 'lock / rate limit',
          connected: 'Connected to Redis (cross-process locks + rate limits shared by all instances)',
          fallback: 'scheduled jobs that need a lock are skipped and rate limits are counted in memory until it connects',
          recovered: 'Redis connected',
        }),
    },
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}

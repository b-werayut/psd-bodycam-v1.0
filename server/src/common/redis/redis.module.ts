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
          connected: 'ต่อ Redis แล้ว (lock ข้ามโปรเซส + นับโควตาร่วมกันทุกอินสแตนซ์)',
          fallback: 'งานตามเวลาที่ต้องใช้ lock จะถูกข้าม และนับโควตาในหน่วยความจำจนกว่าจะต่อติด',
          recovered: 'ต่อ Redis ได้แล้ว',
        }),
    },
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}

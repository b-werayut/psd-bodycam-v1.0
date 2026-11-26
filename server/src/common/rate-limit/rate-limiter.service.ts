import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { lockPrefix } from '../lock/lock-key';
import { REDIS_CLIENT } from '../redis/redis.module';
import { hitFixedWindow, type RateLimitHit, type WindowState } from './fixed-window';

const INCR_WITH_TTL = `
local count = redis.call('incr', KEYS[1])
if count == 1 then
  redis.call('expire', KEYS[1], ARGV[1])
end
return { count, redis.call('ttl', KEYS[1]) }`;

/**
 * Fixed-window counter. Redis ready ⇒ one quota shared by every instance.
 * No Redis ⇒ counts in memory (per instance). Redis error mid-count ⇒ let the request through.
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly local: WindowState = new Map();
  private warnedLocal = false;
  // Same Redis serves dev and the test DB: scope keys by database (lock:bwc → rl:bwc).
  private readonly prefix = `rl:${lockPrefix().replace(/^lock:?/, '') || 'default'}`;

  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClientType | null) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitHit> {
    const client = this.client;
    if (client?.isReady) {
      try {
        const [count, ttl] = (await client.eval(INCR_WITH_TTL, {
          keys: [`${this.prefix}:${key}`],
          arguments: [String(windowSeconds)],
        })) as [number, number];
        return {
          allowed: Number(count) <= limit,
          count: Number(count),
          retryAfterSeconds: Number(ttl) > 0 ? Number(ttl) : windowSeconds,
        };
      } catch (error) {
        this.logger.warn(
          `Counting rate limit in Redis failed (allowing request): ${error instanceof Error ? error.message : String(error)}`,
        );
        return { allowed: true, count: 0, retryAfterSeconds: 0 };
      }
    }

    if (!this.warnedLocal) {
      this.warnedLocal = true;
      this.logger.warn('No Redis - counting rate limits in memory (limits are per instance)');
    }
    return hitFixedWindow(this.local, key, limit, windowSeconds * 1000, Date.now());
  }
}

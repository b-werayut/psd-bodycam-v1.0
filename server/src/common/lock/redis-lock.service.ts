import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { RedisClientType } from 'redis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { lockKey } from './lock-key';

const TOKEN_BYTES = 16;

const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('expire', KEYS[1], ARGV[2])
end
return 0`;

export type LockLease = {
  readonly held: boolean;
  release(): Promise<void>;
};

/**
 * Cross-process lock for sweeps and scheduled jobs (port of the reference).
 * Differs from the reference: without a ready Redis the job is SKIPPED (null), never run unlocked,
 * because two workers sweeping at once is worse than one missed round (Part 2 §2.6).
 */
@Injectable()
export class RedisLockService {
  private readonly logger = new Logger(RedisLockService.name);
  private warnedNoRedis = false;

  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClientType | null) {}

  async withLock<T>(key: string, ttlSeconds: number, run: () => Promise<T>): Promise<T | null> {
    const client = this.readyClient(key);
    if (!client) return null;

    const fullKey = lockKey(key);
    const token = randomBytes(TOKEN_BYTES).toString('hex');
    if ((await client.set(fullKey, token, { NX: true, EX: ttlSeconds })) !== 'OK') {
      this.logger.debug(`ข้ามงาน '${key}' — อินสแตนซ์อื่นถือล็อกอยู่`);
      return null;
    }

    try {
      return await run();
    } finally {
      await this.release(client, fullKey, token, key, ttlSeconds);
    }
  }

  async acquireLease(key: string, ttlSeconds: number, onLost?: () => void): Promise<LockLease | null> {
    const client = this.readyClient(key);
    if (!client) return null;

    const fullKey = lockKey(key);
    const token = randomBytes(TOKEN_BYTES).toString('hex');
    if ((await client.set(fullKey, token, { NX: true, EX: ttlSeconds })) !== 'OK') {
      this.logger.log(`ข้ามงาน '${key}' — อินสแตนซ์อื่นถือล็อกอยู่`);
      return null;
    }

    const state = { held: true };
    const timer = setInterval(
      () => {
        void (async () => {
          if (!state.held) return;
          try {
            const extended = await client.eval(RENEW_SCRIPT, {
              keys: [fullKey],
              arguments: [token, String(ttlSeconds)],
            });
            if (extended === 1) return;
            state.held = false;
            clearInterval(timer);
            this.logger.warn(`เสียล็อก '${key}' ให้อินสแตนซ์อื่น — หยุดงานฝั่งนี้`);
            onLost?.();
          } catch (error) {
            this.logger.warn(`ต่ออายุล็อก '${key}' ไม่สำเร็จ: ${errorMessage(error)}`);
          }
        })();
      },
      Math.max(1, Math.floor(ttlSeconds / 3)) * 1000,
    );
    timer.unref();

    return {
      get held() {
        return state.held;
      },
      release: async () => {
        clearInterval(timer);
        if (!state.held) return;
        state.held = false;
        await this.release(client, fullKey, token, key, ttlSeconds);
      },
    };
  }

  private readyClient(key: string): RedisClientType | null {
    if (this.client?.isReady) return this.client;
    if (!this.warnedNoRedis) {
      this.warnedNoRedis = true;
      this.logger.warn(`ไม่มี Redis สำหรับล็อก — ข้ามงานที่ต้องใช้ล็อก (เช่น '${key}') จนกว่าจะต่อติด`);
    }
    return null;
  }

  private async release(
    client: RedisClientType,
    fullKey: string,
    token: string,
    key: string,
    ttlSeconds: number,
  ): Promise<void> {
    try {
      await client.eval(RELEASE_SCRIPT, { keys: [fullKey], arguments: [token] });
    } catch (error) {
      this.logger.warn(`ปล่อยล็อก '${key}' ไม่สำเร็จ (จะหมดอายุเองใน ${ttlSeconds} วิ): ${errorMessage(error)}`);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

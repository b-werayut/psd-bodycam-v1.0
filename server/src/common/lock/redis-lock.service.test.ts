import { describe, expect, it } from 'vitest';
import type { RedisClientType } from 'redis';
import { RedisLockService } from './redis-lock.service';

// Sweeps must not run unlocked when Redis is missing (Part 2 §2.6) — unlike the reference.
describe('RedisLockService without Redis (fail-safe)', () => {
  it('withLock returns null and never runs the job when there is no client', async () => {
    const lock = new RedisLockService(null);
    let ran = false;
    expect(await lock.withLock('k', 5, async () => { ran = true; return 1; })).toBeNull();
    expect(ran).toBe(false);
  });

  it('withLock returns null when the client exists but is not ready', async () => {
    const lock = new RedisLockService({ isReady: false } as unknown as RedisClientType);
    let ran = false;
    expect(await lock.withLock('k', 5, async () => { ran = true; return 1; })).toBeNull();
    expect(ran).toBe(false);
  });

  it('acquireLease returns null without Redis', async () => {
    expect(await new RedisLockService(null).acquireLease('k', 5)).toBeNull();
  });
});

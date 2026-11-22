import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LockModule } from './lock.module';
import { RedisLockService } from './redis-lock.service';
import { RedisModule } from '../redis/redis.module';
import { Module } from '@nestjs/common';

@Module({ imports: [RedisModule, LockModule] })
class LockTestModule {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('RedisLockService with Redis', () => {
  let app: INestApplicationContext;
  let lock: RedisLockService;

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(LockTestModule, { logger: false });
    lock = app.get(RedisLockService);
  });
  afterAll(async () => {
    await app.close();
  });

  it('runs the job and returns its result', async () => {
    expect(await lock.withLock(`t:${randomUUID()}`, 5, async () => 'ok')).toBe('ok');
  });

  it('two concurrent withLock on one key run the job once', async () => {
    const key = `t:${randomUUID()}`;
    const runs: number[] = [];
    await Promise.all([
      lock.withLock(key, 5, async () => { runs.push(1); await sleep(200); }),
      lock.withLock(key, 5, async () => { runs.push(2); }),
    ]);
    expect(runs).toHaveLength(1);
  });

  it('releases the lock after the job, so the next call runs', async () => {
    const key = `t:${randomUUID()}`;
    await lock.withLock(key, 5, async () => 1);
    expect(await lock.withLock(key, 5, async () => 2)).toBe(2);
  });

  it('a lease blocks others until released', async () => {
    const key = `t:${randomUUID()}`;
    const lease = await lock.acquireLease(key, 5);
    expect(lease?.held).toBe(true);
    expect(await lock.acquireLease(key, 5)).toBeNull();
    await lease?.release();
    const again = await lock.acquireLease(key, 5);
    expect(again?.held).toBe(true);
    await again?.release();
  });
});

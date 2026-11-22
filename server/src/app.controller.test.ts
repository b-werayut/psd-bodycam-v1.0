import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppController } from './app.controller';
import { installBigIntJson } from './common/bigint-json';
import { GlobalExceptionFilter } from './common/errors/global-exception.filter';
import { REDIS_CLIENT } from './common/redis/redis.module';
import { DRIZZLE } from './db/db.constants';

async function boot(db: { execute: () => Promise<unknown> }, redis: unknown): Promise<INestApplication> {
  @Module({
    controllers: [AppController],
    providers: [
      { provide: DRIZZLE, useValue: db },
      { provide: REDIS_CLIENT, useValue: redis },
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    ],
  })
  class AppModuleForTest {}

  const app = await NestFactory.create(AppModuleForTest, { logger: false });
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}

const healthyDb = { execute: () => Promise.resolve([]) };
const readyRedis = { isReady: true, ping: () => Promise.resolve('PONG') };

describe('health endpoints', () => {
  it('GET /api/health, /health/db and /health/redis return ok when everything answers', async () => {
    const app = await boot(healthyDb, readyRedis);
    for (const path of ['/api/health', '/api/health/db', '/api/health/redis']) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status, path).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    }
    await app.close();
  });

  it('DB error ⇒ /health/db 503 SERVICE_UNAVAILABLE', async () => {
    const app = await boot({ execute: () => Promise.reject(new Error('down')) }, readyRedis);
    const res = await request(app.getHttpServer()).get('/api/health/db');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    await app.close();
  });

  it('no Redis client, not ready, or ping failing ⇒ /health/redis 503', async () => {
    for (const redis of [null, { isReady: false }, { isReady: true, ping: () => Promise.reject(new Error('x')) }]) {
      const app = await boot(healthyDb, redis);
      expect((await request(app.getHttpServer()).get('/api/health/redis')).status).toBe(503);
      await app.close();
    }
  });
});

it('serializes bigint as string', () => {
  installBigIntJson();
  expect(JSON.stringify({ id: 12n })).toBe('{"id":"12"}');
});

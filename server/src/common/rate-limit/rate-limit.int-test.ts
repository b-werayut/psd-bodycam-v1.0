import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core';
import supertest from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../bootstrap/configure-app';
import { GlobalExceptionFilter } from '../errors/global-exception.filter';
import { RedisModule } from '../redis/redis.module';
import { RateLimit } from './rate-limit.decorator';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitModule } from './rate-limit.module';

@Controller('rl-test')
class RateLimitTestController {
  @Get()
  @RateLimit('auth-login')
  hit() {
    return { ok: true };
  }

  @Get('free')
  free() {
    return { ok: true };
  }
}

@Module({
  imports: [RedisModule, RateLimitModule],
  controllers: [RateLimitTestController],
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
class RateLimitTestModule {}

const originalLimit = process.env.AUTH_LOGIN_RATE_LIMIT_PER_MIN;
const originalRedis = process.env.REDIS_URL;

const randomIp = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

async function boot(): Promise<INestApplication> {
  const app = await NestFactory.create(RateLimitTestModule, { logger: false });
  await configureApp(app);
  await app.init();
  return app;
}

function suite(label: string, redisUrl: string) {
  describe(`rate limit (${label})`, () => {
    let app: INestApplication;
    let http: supertest.Agent;

    beforeAll(async () => {
      process.env.REDIS_URL = redisUrl;
      process.env.REDIS_CONNECT_TIMEOUT_MS = '500';
      app = await boot();
      http = supertest.agent(app.getHttpServer());
    });
    afterAll(async () => {
      await app.close();
      process.env.REDIS_URL = originalRedis;
      delete process.env.REDIS_CONNECT_TIMEOUT_MS;
    });
    afterEach(() => {
      process.env.AUTH_LOGIN_RATE_LIMIT_PER_MIN = originalLimit;
    });

    it('3rd request from one IP within a minute is 429 with Retry-After', async () => {
      process.env.AUTH_LOGIN_RATE_LIMIT_PER_MIN = '2';
      const ip = `${randomIp()}`;
      const call = () => http.get('/api/rl-test').set('X-Forwarded-For', ip);
      expect((await call()).status).toBe(200);
      expect((await call()).status).toBe(200);
      const third = await call();
      expect(third.status).toBe(429);
      expect(third.body.code).toBe('TOO_MANY_REQUESTS');
      expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('another IP keeps its own quota', async () => {
      process.env.AUTH_LOGIN_RATE_LIMIT_PER_MIN = '1';
      const a = randomIp();
      let b = randomIp();
      while (b === a) b = randomIp();
      expect((await http.get('/api/rl-test').set('X-Forwarded-For', a)).status).toBe(200);
      expect((await http.get('/api/rl-test').set('X-Forwarded-For', a)).status).toBe(429);
      expect((await http.get('/api/rl-test').set('X-Forwarded-For', b)).status).toBe(200);
    });

    it('handlers without @RateLimit are never limited', async () => {
      process.env.AUTH_LOGIN_RATE_LIMIT_PER_MIN = '1';
      for (let i = 0; i < 3; i++) expect((await http.get('/api/rl-test/free')).status).toBe(200);
    });
  });
}

suite('Redis up', originalRedis || 'redis://localhost:6379');
// Nothing listens on this port: counting falls back to memory, limits still apply.
suite('Redis down', 'redis://127.0.0.1:6390');

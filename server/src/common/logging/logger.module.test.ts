import 'reflect-metadata';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import { AppController } from '../../app.controller';
import { RequestContextMiddleware } from '../context/request-context.middleware';
import { createLoggerOptions } from './logger.module';

const lines: string[] = [];
const sink = new Writable({
  write(chunk, _enc, cb) {
    lines.push(...chunk.toString().split('\n').filter(Boolean));
    cb();
  },
});

@Module({ imports: [LoggerModule.forRoot(createLoggerOptions(sink))], controllers: [AppController] })
class M implements NestModule {
  configure(c: MiddlewareConsumer) {
    c.apply(RequestContextMiddleware).forRoutes('*');
  }
}

let app: Awaited<ReturnType<typeof NestFactory.create>>;
beforeAll(async () => {
  app = await NestFactory.create(M, { logger: false });
  app.setGlobalPrefix('api');
  await app.init();
});
afterAll(async () => {
  await app.close();
});

const logged = (id: string) =>
  lines.map((l) => JSON.parse(l)).find((o) => o.req?.url === '/api/health' && o.req?.id === id);

it.each([
  ['with a valid header', 'logtest-abcdef12'],
  ['without a header', undefined],
])('log reqId equals X-Correlation-Id %s', async (_n, hdr) => {
  let r = request(app.getHttpServer()).get('/api/health').set('Authorization', 'Bearer secret').set('Cookie', 'a=b');
  if (hdr) r = r.set('X-Correlation-Id', hdr);
  const res = await r;
  const id = res.headers['x-correlation-id'];
  if (hdr) expect(id).toBe(hdr);
  await new Promise((r2) => setTimeout(r2, 50));
  const entry = logged(id);
  expect(entry).toBeDefined();
  expect(entry.correlationId).toBe(id);
  expect(entry.req.headers.authorization).toBe('[Redacted]');
  expect(entry.req.headers.cookie).toBe('[Redacted]');
});

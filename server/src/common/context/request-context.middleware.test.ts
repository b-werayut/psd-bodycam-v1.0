import 'reflect-metadata';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Controller, Get, INestApplication, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppController } from '../../app.controller';
import { RequestContextMiddleware } from './request-context.middleware';
import { getContext, getCorrelationId, getCurrentUser, getUserId } from './request-context';

@Controller('ctx')
class CtxController {
  @Get()
  ctx() {
    return {
      id: getCorrelationId(),
      same: getContext()?.correlationId === getCorrelationId(),
      u: getUserId() ?? null,
      cu: getCurrentUser() ?? null,
    };
  }
}

@Module({ controllers: [AppController, CtxController] })
class M implements NestModule {
  configure(c: MiddlewareConsumer) {
    c.apply(RequestContextMiddleware).forRoutes('*');
  }
}

let app: INestApplication;
let http: ReturnType<typeof request>;
beforeAll(async () => {
  app = await NestFactory.create(M, { logger: false });
  app.setGlobalPrefix('api');
  await app.init();
  http = request(app.getHttpServer());
});
afterAll(async () => {
  await app.close();
});

it('echoes a valid correlation id', async () => {
  const r = await http.get('/api/health').set('X-Correlation-Id', 'abc12345-test');
  expect(r.headers['x-correlation-id']).toBe('abc12345-test');
});

it('replaces an invalid correlation id with a uuid', async () => {
  const r = await http.get('/api/health').set('X-Correlation-Id', 'bad id!');
  expect(r.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  const short = await http.get('/api/health').set('X-Correlation-Id', 'abc');
  expect(short.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
});

it('exposes the correlation id inside the request context', async () => {
  const r = await http.get('/api/ctx').set('X-Correlation-Id', 'ctx-abcdef12');
  expect(r.body).toEqual({ id: 'ctx-abcdef12', same: true, u: null, cu: null });
});

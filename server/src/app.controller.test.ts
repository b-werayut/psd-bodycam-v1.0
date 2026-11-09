import 'reflect-metadata';
import { it, expect } from 'vitest';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppController } from './app.controller';
import { installBigIntJson } from './common/bigint-json';

@Module({ controllers: [AppController] })
class AppModuleForTest {}

it('GET /api/health returns ok', async () => {
  const app = await NestFactory.create(AppModuleForTest, { logger: false });
  app.setGlobalPrefix('api');
  await app.init();
  const res = await request(app.getHttpServer()).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
  await app.close();
});

it('serializes bigint as string', () => {
  installBigIntJson();
  expect(JSON.stringify({ id: 12n })).toBe('{"id":"12"}');
});

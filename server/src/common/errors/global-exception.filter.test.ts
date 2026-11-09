import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Body,
  Controller,
  Get,
  HttpException,
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  Post,
  Req,
} from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import { IsString } from 'class-validator';
import request from 'supertest';
import { AppController } from '../../app.controller';
import { RequestContextMiddleware } from '../context/request-context.middleware';
import { applyHttpBasics } from '../http/apply-http-basics';
import { AppException } from './app-exception';
import { GlobalExceptionFilter } from './global-exception.filter';
import { ERROR_CODE_BY_STATUS } from './error-codes';

class EchoDto {
  @IsString()
  name!: string;
}

@Controller('t')
class TestController {
  @Get('app')
  app(): never {
    throw new AppException(409, 'DEPARTMENT_IN_USE', 'มีข้อมูลอ้างอิงอยู่', { children: 1 });
  }
  @Get('http')
  http(): never {
    throw new HttpException('nope', 403);
  }
  @Get('boom')
  boom(): never {
    throw new Error('boom');
  }
  @Post('echo')
  echo(@Body() dto: EchoDto) {
    return dto;
  }
  @Post('raw')
  raw(@Body() _b: unknown, @Req() req: { rawBody?: Buffer }) {
    return { len: req.rawBody?.length ?? -1 };
  }
}

@Module({
  controllers: [AppController, TestController],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
class TestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const a = await NestFactory.create(TestModule, { logger: false, rawBody: true });
  applyHttpBasics(a);
  await a.init();
  app = a;
  http = request(a.getHttpServer());
});
afterAll(async () => {
  await app.close();
});

describe('GlobalExceptionFilter', () => {
  it('AppException passes through', async () => {
    const res = await http.get('/api/t/app');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      statusCode: 409,
      code: 'DEPARTMENT_IN_USE',
      message: 'มีข้อมูลอ้างอิงอยู่',
      details: { children: 1 },
      correlationId: expect.any(String),
    });
  });

  it('validation failure -> VALIDATION_FAILED', async () => {
    const res = await http.post('/api/t/echo').send({ unknown: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.messages).toBeInstanceOf(Array);
    expect(res.body.correlationId).toEqual(expect.any(String));
  });

  it('malformed JSON -> 400 BAD_REQUEST json', async () => {
    const res = await http.post('/api/t/echo').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('body over 1MB -> 413', async () => {
    const res = await http.post('/api/t/echo').send({ name: 'x'.repeat(1024 * 1024 + 10) });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('other HttpException maps by status', async () => {
    const res = await http.get('/api/t/http');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ERROR_CODE_BY_STATUS[403]);
    expect(res.body.message).toBe('nope');
  });

  it('unknown route maps to NOT_FOUND', async () => {
    const res = await http.get('/api/nothing-here');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('unknown Error -> 500 without leaking', async () => {
    const res = await http.get('/api/t/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'เกิดข้อผิดพลาดภายในระบบ',
      correlationId: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toContain('boom');
  });

  it('rawBody is still captured', async () => {
    const res = await http.post('/api/t/raw').send({ a: 1 });
    expect(res.body.len).toBe(JSON.stringify({ a: 1 }).length);
  });
});

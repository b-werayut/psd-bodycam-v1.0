import 'dotenv/config';
import 'reflect-metadata';
import { installBigIntJson } from './common/bigint-json';

installBigIntJson();

import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';
import { guardMigrationsOrExit } from './db/assert-migrations';
import { RedisIoAdapter } from './common/realtime-bus/redis-io.adapter';

async function bootstrap(): Promise<void> {
  await guardMigrationsOrExit();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });

  app.useLogger(app.get(PinoLogger));
  await configureApp(app);
  const ioAdapter = new RedisIoAdapter(app);
  await ioAdapter.connect();
  app.useWebSocketAdapter(ioAdapter);
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();

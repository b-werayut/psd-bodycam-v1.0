import 'dotenv/config';
import 'reflect-metadata';
import { installBigIntJson } from './common/bigint-json';

installBigIntJson();

import { NestFactory } from '@nestjs/core';
import { parseWorkerRoles } from './common/config/worker-roles';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const roles = parseWorkerRoles(process.env.WORKER_ROLES);
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoles(roles));
  app.enableShutdownHooks();
}

void bootstrap();

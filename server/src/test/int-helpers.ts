import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres, { type Sql } from 'postgres';
import supertest from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../bootstrap/configure-app';
import type { AuthUserLike } from '../common/auth/auth-user';
import { requestContext } from '../common/context/request-context';

export type TestSql = Sql<{ bigint: bigint }>;

export type HttpContext = {
  app: INestApplication;
  sql: TestSql;
  http: supertest.Agent;
  close(): Promise<void>;
};

/** Boots AppModule exactly like main.api.ts (via configureApp) against the _test database. */
export async function bootHttpContext(): Promise<HttpContext> {
  const sql = postgres(process.env.DATABASE_URL as string, {
    max: 4,
    types: { bigint: postgres.BigInt },
  }) as unknown as TestSql;

  const app = await NestFactory.create(AppModule, { rawBody: true, logger: false });
  await configureApp(app);
  await app.init();

  return {
    app,
    sql,
    http: supertest.agent(app.getHttpServer()),
    close: async () => {
      await app.close();
      await sql.end();
    },
  };
}

/** Runs `fn` inside a request context as `user` (for services that read the current user). */
export function asUser<T>(user: AuthUserLike, fn: () => Promise<T>): Promise<T> {
  return requestContext.run({ correlationId: randomUUID(), userId: user.id, user }, fn);
}

/** Polls `probe` until it returns a truthy value or the timeout elapses. */
export async function eventually<T>(
  probe: () => Promise<T | undefined | null | false>,
  timeoutMs = 3000,
  intervalMs = 50,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== null && value !== false) return value;
    if (Date.now() >= deadline) {
      throw new Error(`eventually(): no result within ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

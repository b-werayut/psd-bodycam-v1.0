import { randomUUID } from 'node:crypto';
import { Module, type INestApplication, type Type } from '@nestjs/common';
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

/**
 * Boots AppModule exactly like main.api.ts (via configureApp) against the _test database.
 * `controllers` adds test-only controllers; the global guards and filters still apply to them.
 */
export async function bootHttpContext(options: { controllers?: Type<unknown>[] } = {}): Promise<HttpContext> {
  const sql = postgres(process.env.DATABASE_URL as string, {
    max: 4,
    types: { bigint: postgres.BigInt },
  }) as unknown as TestSql;

  @Module({ imports: [AppModule], controllers: options.controllers ?? [] })
  class IntTestModule {}

  const app = await NestFactory.create(IntTestModule, { rawBody: true, logger: false });
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

export type TestUserSpec = { username: string; role: string; status?: number; email?: string | null };

/**
 * Inserts users for a test (same password for all). Removes leftovers of the same usernames first.
 * Returns username ⇒ Id.
 */
export async function createTestUsers(
  sql: TestSql,
  users: TestUserSpec[],
  passwordHash: string,
): Promise<Map<string, bigint>> {
  await dropTestUsers(
    sql,
    users.map((u) => u.username),
  );
  const ids = new Map<string, bigint>();
  for (const u of users) {
    const [row] = await sql`
      insert into "Users" ("Username", "FirstName", "LastName", "RoleId", "PasswordHash", "Status", "Email")
      select ${u.username}, 'Test', ${u.username}, r."Id", ${passwordHash}, ${u.status ?? 1}, ${u.email ?? null}
      from "Roles" r where r."Code" = ${u.role}
      returning "Id"`;
    if (!row) throw new Error(`createTestUsers: unknown role ${u.role}`);
    ids.set(u.username, row.Id as bigint);
  }
  return ids;
}

/**
 * Hard-deletes test users (any username matching one of `patterns`, SQL LIKE) and every row that
 * points at them, so FKs (CreatedBy / UpdatedBy / DeletedBy, Settings.UpdatedBy, TeamMembers) never block.
 */
export async function dropTestUsers(sql: TestSql, patterns: string[]): Promise<void> {
  if (!patterns.length) return;
  const ids: bigint[] = [];
  for (const pattern of patterns) {
    for (const row of await sql`select "Id" from "Users" where "Username" like ${pattern}`) ids.push(row.Id as bigint);
  }
  if (!ids.length) return;
  await sql`update "Settings" set "UpdatedBy" = null where "UpdatedBy" in ${sql(ids)}`;
  await sql`update "Users" set "CreatedBy" = null, "UpdatedBy" = null, "DeletedBy" = null
            where "CreatedBy" in ${sql(ids)} or "UpdatedBy" in ${sql(ids)} or "DeletedBy" in ${sql(ids)}`;
  await sql`delete from "TeamMembers" where "UserId" in ${sql(ids)}`;
  await sql`update "TeamMembers" set "AssignedBy" = null where "AssignedBy" in ${sql(ids)}`;
  await sql`delete from "PushTokens" where "UserId" in ${sql(ids)}`;
  await sql`delete from "RefreshTokens" where "UserId" in ${sql(ids)}`;
  await sql`delete from "UserDevices" where "UserId" in ${sql(ids)}`;
  await sql`delete from "StreamingSessions" where "UserId" in ${sql(ids)}`;
  await sql`delete from "Users" where "Id" in ${sql(ids)}`;
}

/** Logs in through the API and returns the Bearer header value. */
export async function bearerFor(
  http: ReturnType<typeof supertest>,
  username: string,
  password: string,
): Promise<string> {
  const r = await http.post('/api/auth/login').send({ username, password });
  if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return `Bearer ${r.body.accessToken}`;
}

/**
 * Removes every camera and what hangs off it (P1+). Device tests share one test DB and DeviceSync
 * marks any local camera missing from its vendor list, so each device test starts from no cameras.
 */
export async function resetDevices(sql: TestSql): Promise<void> {
  await sql`delete from "StreamingSessions"`;
  await sql`delete from "Alerts" where "DeviceId" is not null or "DedupeKey" like '13:device:%'`;
  await sql`delete from "GpsLocations"`;
  await sql`delete from "DeviceStatusHistory"`;
  await sql`delete from "DeviceState"`;
  await sql`delete from "Devices"`;
}

/** A RealtimeGateway stand-in that records every emit as [room, event, payload]. */
export function recordingGateway(): { gateway: { bus: unknown }; emits: [string, string, unknown][] } {
  const emits: [string, string, unknown][] = [];
  const target = (room: string) => ({
    emit: (event: string, payload: unknown) => {
      emits.push([room, event, payload]);
    },
    to: (next: string) => target(next),
  });
  return { gateway: { bus: { to: target } }, emits };
}

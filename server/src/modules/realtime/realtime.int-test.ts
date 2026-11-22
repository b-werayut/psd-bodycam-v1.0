import type { AddressInfo } from 'node:net';
import { Module, type INestApplication, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres from 'postgres';
import { io, type Socket } from 'socket.io-client';
import supertest from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../bootstrap/configure-app';
import { hashPassword } from '../../common/auth/password';
import { RealtimeEmitterService } from '../../common/realtime-bus/realtime-emitter.service';
import { RedisIoAdapter } from '../../common/realtime-bus/redis-io.adapter';
import { bearerFor, createTestUsers, dropTestUsers, type TestSql } from '../../test/int-helpers';
import { RealtimeGateway } from './realtime.gateway';

const PASSWORD = 'Test@12345';
const PREFIX = 't10_';

let app: INestApplication;
let worker: INestApplicationContext;
let sql: TestSql;
let http: ReturnType<typeof supertest>;
let baseUrl: string;
let ids: Map<string, bigint>;
const sockets: Socket[] = [];

@Module({ providers: [RealtimeEmitterService] })
class WorkerEmitterModule {}

const connect = (token: string | undefined): Socket => {
  const socket = io(`${baseUrl}/realtime`, {
    auth: token === undefined ? {} : { token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  return socket;
};

const outcome = (socket: Socket) =>
  new Promise<'connected' | string>((resolve) => {
    socket.once('connect', () => resolve('connected'));
    socket.once('connect_error', (err) => resolve(err.message));
  });

const next = <T = unknown>(socket: Socket, event: string, timeoutMs = 3000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${timeoutMs} ms`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const accessTokenOf = async (username: string) => (await bearerFor(http, username, PASSWORD)).slice('Bearer '.length);

beforeAll(async () => {
  sql = postgres(process.env.DATABASE_URL as string, {
    max: 2,
    types: { bigint: postgres.BigInt },
    onnotice: () => undefined,
  }) as unknown as TestSql;

  // Same wiring as main.api.ts: Redis adapter so a worker emitter reaches these sockets.
  app = await NestFactory.create(AppModule, { logger: false });
  await configureApp(app);
  const adapter = new RedisIoAdapter(app);
  await adapter.connect();
  app.useWebSocketAdapter(adapter);
  await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  http = supertest(app.getHttpServer());

  worker = await NestFactory.createApplicationContext(WorkerEmitterModule, { logger: false });

  ids = await createTestUsers(
    sql,
    [
      { username: `${PREFIX}admin`, role: 'ADMIN' },
      { username: `${PREFIX}viewer`, role: 'VIEWER' },
      { username: `${PREFIX}victim`, role: 'OPERATOR' },
    ],
    await hashPassword(PASSWORD),
  );
});

afterEach(() => {
  while (sockets.length) sockets.pop()?.disconnect();
});

afterAll(async () => {
  await dropTestUsers(sql, [`${PREFIX}%`]);
  await worker.close();
  await app.close();
  await sql.end();
});

describe('handshake auth', () => {
  it('no token ⇒ connect_error "unauthorized"', async () => {
    expect(await outcome(connect(undefined))).toBe('unauthorized');
  });

  it('garbage token ⇒ connect_error "unauthorized"', async () => {
    expect(await outcome(connect('not-a-jwt'))).toBe('unauthorized');
  });

  it('a valid access token connects', async () => {
    expect(await outcome(connect(await accessTokenOf(`${PREFIX}viewer`)))).toBe('connected');
  });

  it('a still-valid token of a suspended account is refused', async () => {
    const token = await accessTokenOf(`${PREFIX}viewer`);
    await sql`update "Users" set "Status" = 2 where "Username" = ${`${PREFIX}viewer`}`;
    try {
      expect(await outcome(connect(token))).toBe('unauthorized');
    } finally {
      await sql`update "Users" set "Status" = 1 where "Username" = ${`${PREFIX}viewer`}`;
    }
  });
});

describe('rooms and the worker bus', () => {
  it('the client is in org and user:{id}', async () => {
    const socket = connect(await accessTokenOf(`${PREFIX}viewer`));
    await outcome(socket);
    const gateway = app.get(RealtimeGateway);
    const own = next(socket, 'test:own');
    gateway.server.to(`user:${ids.get(`${PREFIX}viewer`)}`).emit('test:own', { ok: 1 });
    expect(await own).toEqual({ ok: 1 });
    const org = next(socket, 'test:org');
    gateway.server.to('org').emit('test:org', { ok: 2 });
    expect(await org).toEqual({ ok: 2 });
  });

  it('an event emitted by a worker process (Redis emitter) reaches the socket', async () => {
    const socket = connect(await accessTokenOf(`${PREFIX}viewer`));
    await outcome(socket);
    const bus = worker.get(RealtimeEmitterService).bus;
    expect(bus).not.toBeNull();
    const received = next(socket, 'test:from-worker');
    bus?.to(`user:${ids.get(`${PREFIX}viewer`)}`).emit('test:from-worker', { hello: 'api' });
    expect(await received).toEqual({ hello: 'api' });
  });
});

describe('Review Focus 4: suspending a user with an open socket', () => {
  it('the socket gets session:revoked (scope account) and is disconnected by the server', async () => {
    const victim = connect(await accessTokenOf(`${PREFIX}victim`));
    expect(await outcome(victim)).toBe('connected');
    const revoked = next<{ scope: string; reason: string }>(victim, 'session:revoked');
    const disconnected = next<string>(victim, 'disconnect');

    const admin = await bearerFor(http, `${PREFIX}admin`, PASSWORD);
    const r = await http
      .patch(`/api/users/${ids.get(`${PREFIX}victim`)}/access`)
      .set('Authorization', admin)
      .send({ enabled: false });
    expect(r.status).toBe(200);

    const payload = await revoked;
    expect(payload.scope).toBe('account');
    expect(payload.reason).toMatch(/[ก-๙]/);
    expect(await disconnected).toBe('io server disconnect');

    await http.patch(`/api/users/${ids.get(`${PREFIX}victim`)}/access`).set('Authorization', admin).send({ enabled: true });
  });
});

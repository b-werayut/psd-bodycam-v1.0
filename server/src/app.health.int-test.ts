import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from './common/auth/password';
import { bootHttpContext, createTestUsers, dropTestUsers, type HttpContext } from './test/int-helpers';

/** Boots the app with some env overridden at boot (DbModule / Redis read env when the app starts). */
async function bootWith(overrides: Record<string, string>): Promise<HttpContext> {
  const saved = Object.fromEntries(Object.keys(overrides).map((k) => [k, process.env[k]]));
  Object.assign(process.env, overrides);
  try {
    return await bootHttpContext();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('health, docs and security headers (normal app)', () => {
  let ctx: HttpContext;
  let http: ReturnType<typeof supertest>;

  beforeAll(async () => {
    ctx = await bootHttpContext();
    http = supertest(ctx.app.getHttpServer());
  });
  afterAll(() => ctx.close());

  it('GET /api/health, /api/health/db and /api/health/redis are public and 200', async () => {
    for (const path of ['/api/health', '/api/health/db', '/api/health/redis']) {
      const r = await http.get(path);
      expect(r.status, path).toBe(200);
      expect(r.body).toEqual({ status: 'ok' });
    }
  });

  it('responses carry helmet headers', async () => {
    const r = await http.get('/api/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('Swagger UI at /api/docs and JSON at /api/docs-json list the API with bearer auth', async () => {
    const json = await http.get('/api/docs-json');
    expect(json.status).toBe(200);
    expect(json.body.paths['/api/auth/login']).toBeDefined();
    expect(json.body.paths['/api/users']).toBeDefined();
    expect(json.body.components.securitySchemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(json.body.servers ?? []).toEqual([]);
    const ui = await http.get('/api/docs');
    expect(ui.status).toBe(200);
    expect(ui.text).toContain('swagger');
  });
});

describe('health when PostgreSQL is unreachable', () => {
  let ctx: HttpContext;

  beforeAll(async () => {
    ctx = await bootWith({ DATABASE_URL: 'postgres://bwc:x@127.0.0.1:1/bwc_test' });
  });
  afterAll(() => ctx.close());

  it('/api/health/db ⇒ 503 SERVICE_UNAVAILABLE; /api/health stays 200', async () => {
    const http = supertest(ctx.app.getHttpServer());
    const db = await http.get('/api/health/db');
    expect(db.status).toBe(503);
    expect(db.body.code).toBe('SERVICE_UNAVAILABLE');
    expect((await http.get('/api/health')).status).toBe(200);
  });
});

describe('Review Focus 5: Redis down on the dev machine', () => {
  let ctx: HttpContext;
  const PASSWORD = 'Test@12345';

  beforeAll(async () => {
    ctx = await bootWith({ REDIS_URL: 'redis://127.0.0.1:6390', REDIS_CONNECT_TIMEOUT_MS: '500' });
    await createTestUsers(ctx.sql, [{ username: 't11_viewer', role: 'VIEWER' }], await hashPassword(PASSWORD));
  });
  afterAll(async () => {
    await dropTestUsers(ctx.sql, ['t11_%']);
    await ctx.close();
  });

  it('/api/health/redis ⇒ 503, but login and refresh still work', async () => {
    const http = supertest(ctx.app.getHttpServer());
    const redis = await http.get('/api/health/redis');
    expect(redis.status).toBe(503);
    expect(redis.body.code).toBe('SERVICE_UNAVAILABLE');

    const login = await http.post('/api/auth/login').send({ username: 't11_viewer', password: PASSWORD });
    expect(login.status).toBe(200);
    const cookie = ([] as string[]).concat(login.headers['set-cookie']).find((c) => c.startsWith('refresh_token='))!;
    expect((await http.post('/api/auth/refresh').set('Cookie', cookie.split(';')[0])).status).toBe(200);
  });
});

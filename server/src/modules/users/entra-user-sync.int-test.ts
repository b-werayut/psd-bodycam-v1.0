import supertest from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import {
  bearerFor,
  bootHttpContext,
  createTestUsers,
  dropTestUsers,
  eventually,
  type HttpContext,
  type TestSql,
} from '../../test/int-helpers';

const PASSWORD = 'Test@12345';
const PREFIX = 't9e_';
const OID = {
  linkme: '0a000000-0000-4000-8000-000000000001',
  noemail: '0a000000-0000-4000-8000-000000000002',
  admin: '0a000000-0000-4000-8000-000000000003',
  newbie: '0a000000-0000-4000-8000-000000000004',
};
const GRAPH_ENV = {
  GRAPH_TENANT_ID: '22222222-3333-4444-5555-666666666666',
  GRAPH_CLIENT_ID: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
  GRAPH_CLIENT_SECRET: 'graph-secret-for-tests',
  GRAPH_ALLOWED_DOMAINS: '',
};

const graphUser = (id: string, upn: string, displayName: string) => ({
  id,
  userPrincipalName: upn,
  displayName,
  mail: upn,
  accountEnabled: true,
  userType: 'Member',
});
const ENTRA = [
  graphUser(OID.linkme, `${PREFIX}linkme@example.test`, 'Link Me From Entra'),
  graphUser(OID.noemail, `${PREFIX}noemail@example.test`, 'No Email'),
  graphUser(OID.admin, `${PREFIX}admin@example.test`, 'The Admin'),
  graphUser(OID.newbie, `${PREFIX}newbie@example.test`, 'New Bie'),
];

let ctx: HttpContext;
let sql: TestSql;
let http: ReturnType<typeof supertest>;
const realFetch = globalThis.fetch;
const graphCalls: string[] = [];

/** Microsoft endpoints answered locally; everything else goes to the real fetch. */
function stubMicrosoft() {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://login.microsoftonline.com/')) {
      graphCalls.push('token');
      return new Response(JSON.stringify({ access_token: 'graph-token' }), { status: 200 });
    }
    if (url.startsWith('https://graph.microsoft.com/v1.0/users')) {
      graphCalls.push('users');
      return new Response(JSON.stringify({ value: ENTRA }), { status: 200 });
    }
    return realFetch(input, init);
  });
}

const userRow = (username: string) =>
  sql`select "Email", "FullName", "AzureObjectId" from "Users" where "Username" = ${username}`.then(([r]) => r);

beforeAll(async () => {
  ctx = await bootHttpContext();
  sql = ctx.sql;
  http = supertest(ctx.app.getHttpServer());
});

beforeEach(async () => {
  await dropTestUsers(sql, [`${PREFIX}%`]);
  await createTestUsers(
    sql,
    [
      { username: `${PREFIX}admin`, role: 'ADMIN', email: `${PREFIX}admin@example.test` },
      { username: `${PREFIX}company`, role: 'COMPANY_ADMIN' },
      { username: `${PREFIX}viewer`, role: 'VIEWER' },
      { username: `${PREFIX}linkme`, role: 'VIEWER', email: `${PREFIX}linkme@example.test` },
      { username: `${PREFIX}noemail`, role: 'VIEWER' },
    ],
    await hashPassword(PASSWORD),
  );
  Object.assign(process.env, GRAPH_ENV);
  graphCalls.length = 0;
  stubMicrosoft();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(GRAPH_ENV)) delete process.env[key];
});

afterAll(async () => {
  await dropTestUsers(sql, [`${PREFIX}%`]);
  await ctx.close();
});

describe('Entra directory (dry run)', () => {
  it('GET /users/entra-directory compares without writing anything', async () => {
    const admin = await bearerFor(http, `${PREFIX}admin`, PASSWORD);
    const r = await http.get('/api/users/entra-directory').set('Authorization', admin);
    expect(r.status).toBe(200);
    expect(graphCalls).toEqual(['token', 'users']);
    expect(r.body).toMatchObject({ dryRun: true, applied: 0, entraTotal: 4, entraFetched: 4 });

    const link = r.body.updates.find((u: { upn: string }) => u.upn === `${PREFIX}linkme@example.test`);
    expect(link).toMatchObject({ username: `${PREFIX}linkme`, patch: { AzureObjectId: OID.linkme }, keptLocal: ['FullName'] });
    expect(typeof link.userId).toBe('string');
    expect(r.body.missingInSystem.map((m: { upn: string }) => m.upn)).toContain(`${PREFIX}newbie@example.test`);
    expect(r.body.entraFields).toContain('userPrincipalName');

    expect((await userRow(`${PREFIX}linkme`)).AzureObjectId).toBeNull();
  });

  it('without GRAPH_* ⇒ 400 GRAPH_NOT_CONFIGURED naming the missing settings, Graph never called', async () => {
    for (const key of Object.keys(GRAPH_ENV)) delete process.env[key];
    const admin = await bearerFor(http, `${PREFIX}admin`, PASSWORD);
    const r = await http.get('/api/users/entra-directory').set('Authorization', admin);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('GRAPH_NOT_CONFIGURED');
    expect(r.body.message).toContain('GRAPH_CLIENT_ID');
    expect(graphCalls).toEqual([]);
  });

  it('VIEWER ⇒ 403', async () => {
    const viewer = await bearerFor(http, `${PREFIX}viewer`, PASSWORD);
    expect((await http.get('/api/users/entra-directory').set('Authorization', viewer)).status).toBe(403);
  });
});

describe('POST /users/sync-entra', () => {
  it('dryRun defaults to true', async () => {
    const admin = await bearerFor(http, `${PREFIX}admin`, PASSWORD);
    const r = await http.post('/api/users/sync-entra').set('Authorization', admin).send({});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dryRun: true, applied: 0 });
    expect((await userRow(`${PREFIX}linkme`)).AzureObjectId).toBeNull();
  });

  it('ADMIN applies: links oids, fills only empty fields, matches by username when asked', async () => {
    const admin = await bearerFor(http, `${PREFIX}admin`, PASSWORD);
    const r = await http
      .post('/api/users/sync-entra')
      .set('Authorization', admin)
      .send({ dryRun: false, matchByUsername: true });
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(false);
    expect(r.body.applied).toBeGreaterThanOrEqual(3);

    expect(await userRow(`${PREFIX}linkme`)).toEqual({
      Email: `${PREFIX}linkme@example.test`,
      FullName: `Test ${PREFIX}linkme`,
      AzureObjectId: OID.linkme,
    });
    expect(await userRow(`${PREFIX}noemail`)).toMatchObject({
      Email: `${PREFIX}noemail@example.test`,
      AzureObjectId: OID.noemail,
    });
    expect((await userRow(`${PREFIX}admin`)).AzureObjectId).toBe(OID.admin);
    expect(await sql`select 1 from "Users" where "Username" = ${`${PREFIX}newbie`}`).toHaveLength(0);

    const audit = await eventually(async () => {
      const [row] = await sql`select "Result" from "AuditLogs" where "Action" = 'SYNC_ENTRA_USERS'
                              and "ActorUsername" = ${`${PREFIX}admin`} order by "Id" desc limit 1`;
      return row;
    });
    expect(audit.Result).toBe(1);
  });

  it('COMPANY_ADMIN never sees or touches an ADMIN account through the sync', async () => {
    const company = await bearerFor(http, `${PREFIX}company`, PASSWORD);
    const r = await http.post('/api/users/sync-entra').set('Authorization', company).send({ dryRun: false });
    expect(r.status).toBe(200);

    const adminUpn = `${PREFIX}admin@example.test`;
    const text = JSON.stringify({
      updates: r.body.updates,
      missingInSystem: r.body.missingInSystem,
      entraUsers: r.body.entraUsers,
      conflicts: r.body.conflicts,
      notInEntra: r.body.notInEntra,
    });
    expect(text).not.toContain(adminUpn);
    expect(text).not.toContain(OID.admin);
    expect(r.body.notInEntra.map((n: { username: string }) => n.username)).not.toContain(`${PREFIX}admin`);
    expect(r.body.entraTotal).toBe(3);
    expect((await userRow(`${PREFIX}admin`)).AzureObjectId).toBeNull();
    expect((await userRow(`${PREFIX}linkme`)).AzureObjectId).toBe(OID.linkme);
  });
});

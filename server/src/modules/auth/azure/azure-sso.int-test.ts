import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from 'jose';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../../common/auth/password';
import {
  bootHttpContext,
  createTestUsers,
  dropTestUsers,
  eventually,
  type HttpContext,
  type TestSql,
} from '../../../test/int-helpers';
import { AZURE_AD_CONFIG, type AzureAdConfig } from './azure-ad.config';

// int-setup.ts sets fake AZURE_AD_TENANT_ID / AZURE_AD_CLIENT_ID; the JWKS is served locally.
const TENANT = process.env.AZURE_AD_TENANT_ID as string;
const CLIENT = process.env.AZURE_AD_CLIENT_ID as string;
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const KID = 'int-sso-key';
const PREFIX = 't5s_';
const EMAIL = `${PREFIX}sso@example.test`;
const OID = '77777777-6666-5555-4444-333333333333';
const PASSWORD = 'Test@12345';

let ctx: HttpContext;
let sql: TestSql;
let http: ReturnType<typeof supertest>;
let jwks: Server;
let key: KeyLike;
let rogue: KeyLike;

const signIdToken = (over: { oid?: string; email?: string; aud?: string; iss?: string; tid?: string; exp?: string; key?: KeyLike } = {}) =>
  new SignJWT({ oid: over.oid ?? OID, tid: over.tid ?? TENANT, preferred_username: over.email ?? EMAIL, name: 'SSO Tester' })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuer(over.iss ?? ISSUER)
    .setAudience(over.aud ?? CLIENT)
    .setIssuedAt()
    .setExpirationTime(over.exp ?? '5m')
    .sign(over.key ?? key);

const azureLogin = (idToken: string) => http.post('/api/auth/azure').send({ idToken });

const userRow = () =>
  sql`select "AzureObjectId", "FailedLoginCount", "LockedUntil", "LastLoginAt" from "Users"
      where "Username" = ${`${PREFIX}sso`}`.then(([r]) => r);

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  key = pair.privateKey;
  rogue = (await generateKeyPair('RS256')).privateKey;
  const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  jwks = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve));

  ctx = await bootHttpContext();
  sql = ctx.sql;
  http = supertest(ctx.app.getHttpServer());
  ctx.app.get<AzureAdConfig>(AZURE_AD_CONFIG).jwksUri = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/keys`;
});

beforeEach(async () => {
  await createTestUsers(
    sql,
    [
      { username: `${PREFIX}sso`, role: 'OPERATOR', email: EMAIL },
      { username: `${PREFIX}other`, role: 'VIEWER', email: `${PREFIX}other@example.test` },
    ],
    await hashPassword(PASSWORD),
  );
});

afterAll(async () => {
  await dropTestUsers(sql, [`${PREFIX}%`]);
  await ctx.close();
  await new Promise<void>((resolve) => jwks.close(() => resolve()));
});

describe('GET /api/auth/config', () => {
  it('reports SSO with the authority the SPA hands to MSAL', async () => {
    const r = await http.get('/api/auth/config');
    expect(r.body).toEqual({
      sso: { enabled: true, clientId: CLIENT, tenantId: TENANT, authority: `https://login.microsoftonline.com/${TENANT}` },
      passwordLogin: { enabled: true },
    });
  });
});

describe('POST /api/auth/azure', () => {
  it('email matches an unlinked account ⇒ our tokens + refresh cookie, and the oid gets linked', async () => {
    const r = await azureLogin(await signIdToken());
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ username: `${PREFIX}sso`, roleCode: 'OPERATOR' });
    expect(typeof r.body.accessToken).toBe('string');
    expect(([] as string[]).concat(r.headers['set-cookie']).some((c) => c.startsWith('refresh_token='))).toBe(true);
    const row = await userRow();
    expect(row.AzureObjectId).toBe(OID);
    expect(row.LastLoginAt).not.toBeNull();

    const audit = await eventually(async () => {
      const [found] = await sql`select "Result" from "AuditLogs" where "Action" = 'LOGIN_SSO'
                                and "ActorUsername" = ${`${PREFIX}sso`} order by "Id" desc limit 1`;
      return found;
    });
    expect(audit.Result).toBe(1);
  });

  it('later logins match by oid, even after the email changed in Entra', async () => {
    await sql`update "Users" set "AzureObjectId" = ${OID} where "Username" = ${`${PREFIX}sso`}`;
    const r = await azureLogin(await signIdToken({ email: `${PREFIX}renamed@example.test` }));
    expect(r.status).toBe(200);
    expect(r.body.user.username).toBe(`${PREFIX}sso`);
  });

  it('no matching account ⇒ 401 SSO_ACCOUNT_NOT_FOUND naming the email, audited as LOGIN_SSO_DENIED', async () => {
    const r = await azureLogin(await signIdToken({ oid: '00000000-0000-4000-8000-00000000abcd', email: `${PREFIX}nobody@example.test` }));
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('SSO_ACCOUNT_NOT_FOUND');
    expect(r.body.message).toContain(`${PREFIX}nobody@example.test`);
    const audit = await eventually(async () => {
      const [found] = await sql`select "Result" from "AuditLogs" where "Action" = 'LOGIN_SSO_DENIED'
                                and "ActorUsername" = ${`${PREFIX}nobody@example.test`} limit 1`;
      return found;
    });
    expect(audit.Result).toBe(2);
  });

  it('email matches an account already linked to another oid ⇒ 401, link unchanged', async () => {
    await sql`update "Users" set "AzureObjectId" = 'another-oid' where "Username" = ${`${PREFIX}sso`}`;
    const r = await azureLogin(await signIdToken());
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('SSO_ACCOUNT_NOT_FOUND');
    expect((await userRow()).AzureObjectId).toBe('another-oid');
  });

  it('a suspended account ⇒ 401 ACCOUNT_DISABLED', async () => {
    await sql`update "Users" set "Status" = 2 where "Username" = ${`${PREFIX}sso`}`;
    const r = await azureLogin(await signIdToken());
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('ACCOUNT_DISABLED');
  });

  it('a password lockout does not block SSO, and SSO lifts it', async () => {
    await sql`update "Users" set "FailedLoginCount" = 3, "LockedUntil" = now() + interval '15 minutes'
              where "Username" = ${`${PREFIX}sso`}`;
    expect((await azureLogin(await signIdToken())).status).toBe(200);
    expect(await userRow()).toMatchObject({ FailedLoginCount: 0, LockedUntil: null });
  });

  it('forged / foreign / expired tokens ⇒ 401 SSO_TOKEN_INVALID and nothing is linked', async () => {
    const bad = [
      await signIdToken({ key: rogue }),
      await signIdToken({ aud: 'https://graph.microsoft.com' }),
      await signIdToken({ iss: 'https://login.microsoftonline.com/other-tenant/v2.0' }),
      await signIdToken({ exp: '-5m' }),
      await signIdToken({ tid: '99999999-9999-4999-8999-999999999999' }),
    ];
    for (const token of bad) {
      const r = await azureLogin(token);
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('SSO_TOKEN_INVALID');
    }
    expect((await userRow()).AzureObjectId).toBeNull();
  });

  it('missing idToken ⇒ 400 VALIDATION_FAILED', async () => {
    expect((await http.post('/api/auth/azure').send({})).body.code).toBe('VALIDATION_FAILED');
  });

  it('password login keeps working next to SSO', async () => {
    expect((await http.post('/api/auth/login').send({ username: `${PREFIX}other`, password: PASSWORD })).status).toBe(200);
  });
});

import { Controller, Get } from '@nestjs/common';
import supertest from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { LoginOnly } from '../../common/auth/login-only.decorator';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { bootHttpContext, type HttpContext, type TestSql } from '../../test/int-helpers';

@Controller('guard-test')
class GuardTestController {
  @Get('audit')
  @RequirePermission('audit:view')
  audit() {
    return { ok: true };
  }

  @Get('login-only')
  @LoginOnly()
  loginOnly() {
    return { ok: true };
  }

  // No permission decorator on purpose: the guard must refuse it (secure by default).
  @Get('bare')
  bare() {
    return { ok: true };
  }
}

const PASSWORD = 'Test@12345';
const USERS = [
  ['t4a_admin', 'SUPER_ADMIN', 1],
  ['t4a_company', 'ADMIN', 1],
  ['t4a_operator', 'OPERATOR', 1],
  ['t4a_viewer', 'VIEWER', 1],
  ['t4a_disabled', 'VIEWER', 2],
  ['t4a_locker', 'VIEWER', 1],
] as const;
const USERNAMES = USERS.map(([u]) => u);

let ctx: HttpContext;
let sql: TestSql;
let http: ReturnType<typeof supertest>;

const login = (username: string, password = PASSWORD) =>
  http.post('/api/auth/login').send({ username, password });

const refreshCookieOf = (res: supertest.Response): string => {
  const header = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = header.find((c) => c.startsWith('refresh_token='));
  if (!cookie) throw new Error('no refresh_token cookie in response');
  return cookie.split(';')[0];
};

const refreshWith = (cookie: string) => http.post('/api/auth/refresh').set('Cookie', cookie);

async function resetUsers() {
  await sql`delete from "RefreshTokens" where "UserId" in (select "Id" from "Users" where "Username" in ${sql(USERNAMES)})`;
  await sql`update "Users" set "FailedLoginCount" = 0, "LockedUntil" = null where "Username" in ${sql(USERNAMES)}`;
}

beforeAll(async () => {
  ctx = await bootHttpContext({ controllers: [GuardTestController] });
  sql = ctx.sql;
  http = supertest(ctx.app.getHttpServer());

  await sql`delete from "RefreshTokens" where "UserId" in (select "Id" from "Users" where "Username" in ${sql(USERNAMES)})`;
  await sql`delete from "Users" where "Username" in ${sql(USERNAMES)}`;
  const hash = await hashPassword(PASSWORD);
  for (const [username, role, status] of USERS) {
    await sql`
      insert into "Users" ("Username", "FirstName", "LastName", "RoleId", "PasswordHash", "Status", "Email")
      select ${username}, 'T4A', ${username}, r."Id", ${hash}, ${status}, ${username + '@example.test'}
      from "Roles" r where r."Code" = ${role}`;
  }
});

beforeEach(resetUsers);

afterAll(async () => {
  await sql`delete from "RefreshTokens" where "UserId" in (select "Id" from "Users" where "Username" in ${sql(USERNAMES)})`;
  await sql`delete from "Users" where "Username" in ${sql(USERNAMES)}`;
  await ctx.close();
});

describe('POST /api/auth/login', () => {
  it('logs in with a case/space-insensitive username and sets the refresh cookie', async () => {
    const r = await login(' T4A_Admin ');
    expect(r.status).toBe(200);
    expect(typeof r.body.accessToken).toBe('string');
    expect(r.body.user).toMatchObject({
      username: 't4a_admin',
      firstName: 'T4A', lastName: 't4a_admin',
      email: 't4a_admin@example.test',
      roleCode: 'SUPER_ADMIN',
      roleName: 'ผู้ดูแลระบบสูงสุด',
    });
    expect(typeof r.body.user.id).toBe('string');
    expect(r.body.user.permissions).toHaveLength(24);
    const cookie = ([] as string[]).concat(r.headers['set-cookie']).find((c) => c.startsWith('refresh_token='));
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('records LastLoginAt', async () => {
    await login('t4a_viewer');
    const [row] = await sql`select "LastLoginAt" from "Users" where "Username" = 't4a_viewer'`;
    expect(row.LastLoginAt).not.toBeNull();
  });

  it('wrong password and unknown user give the same 401 INVALID_CREDENTIALS', async () => {
    const wrong = await login('t4a_viewer', 'nope');
    const unknown = await login('t4a_nobody', 'nope');
    for (const r of [wrong, unknown]) {
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('INVALID_CREDENTIALS');
    }
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('3 wrong passwords lock the account for 15 minutes; the right password is refused while locked', async () => {
    expect((await login('t4a_locker', 'bad-1')).body.code).toBe('INVALID_CREDENTIALS');
    expect((await login('t4a_locker', 'bad-2')).body.code).toBe('INVALID_CREDENTIALS');
    const third = await login('t4a_locker', 'bad-3');
    expect(third.status).toBe(401);
    expect(third.body.code).toBe('ACCOUNT_LOCKED_TEMPORARY');
    expect(third.body.details.retryAfterMinutes).toBe(15);
    expect(third.body.message).toContain('15 นาที');

    const right = await login('t4a_locker');
    expect(right.status).toBe(401);
    expect(right.body.code).toBe('ACCOUNT_LOCKED_TEMPORARY');

    const [row] = await sql`select "FailedLoginCount", "LockedUntil" from "Users" where "Username" = 't4a_locker'`;
    expect(row.FailedLoginCount).toBe(3);
    const minutesLeft = (new Date(row.LockedUntil).getTime() - Date.now()) / 60_000;
    expect(minutesLeft).toBeGreaterThan(14);
    expect(minutesLeft).toBeLessThanOrEqual(15);
  });

  it('after the lock ends the right password works and resets the counter', async () => {
    await sql`update "Users" set "FailedLoginCount" = 3, "LockedUntil" = now() - interval '1 minute'
              where "Username" = 't4a_locker'`;
    expect((await login('t4a_locker')).status).toBe(200);
    const [row] = await sql`select "FailedLoginCount", "LockedUntil" from "Users" where "Username" = 't4a_locker'`;
    expect(row.FailedLoginCount).toBe(0);
    expect(row.LockedUntil).toBeNull();
  });

  it('a successful login resets earlier failures', async () => {
    await login('t4a_locker', 'bad');
    await login('t4a_locker', 'bad');
    expect((await login('t4a_locker')).status).toBe(200);
    expect((await login('t4a_locker', 'bad')).body.code).toBe('INVALID_CREDENTIALS');
  });

  it('Status=2 cannot log in, even with the right password', async () => {
    const r = await login('t4a_disabled');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('ACCOUNT_DISABLED');
  });

  it('ADMIN never carries an SUPER_ADMIN-reserved permission, even if a row grants it', async () => {
    await sql`insert into "RolePermissions" ("RoleId", "PermissionId")
              select r."Id", p."Id" from "Roles" r, "Permissions" p
              where r."Code" = 'ADMIN' and p."Code" = 'audit:view' on conflict do nothing`;
    try {
      const r = await login('t4a_company');
      expect(r.status).toBe(200);
      expect(r.body.user.permissions).toHaveLength(21);
      expect(r.body.user.permissions).not.toContain('audit:view');
    } finally {
      await sql`delete from "RolePermissions" where "RoleId" = (select "Id" from "Roles" where "Code" = 'ADMIN')
                and "PermissionId" = (select "Id" from "Permissions" where "Code" = 'audit:view')`;
    }
  });

  it('rejects a body with missing or extra fields (400 VALIDATION_FAILED)', async () => {
    expect((await http.post('/api/auth/login').send({ username: 'x' })).body.code).toBe('VALIDATION_FAILED');
    expect((await http.post('/api/auth/login').send({ username: 'x', password: 'y', role: 'SUPER_ADMIN' })).status).toBe(400);
  });

  it('AUTH_PASSWORD_LOGIN_ENABLED=false ⇒ 403 PASSWORD_LOGIN_DISABLED', async () => {
    process.env.AUTH_PASSWORD_LOGIN_ENABLED = 'false';
    try {
      const r = await login('t4a_admin');
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('PASSWORD_LOGIN_DISABLED');
    } finally {
      process.env.AUTH_PASSWORD_LOGIN_ENABLED = 'true';
    }
  });
});

describe('GET /api/auth/config and /api/auth/me', () => {
  it('config is public and reports password login + SSO settings', async () => {
    const r = await http.get('/api/auth/config');
    expect(r.status).toBe(200);
    expect(r.body.passwordLogin).toEqual({ enabled: true });
    expect(r.body.sso).toEqual({
      enabled: true,
      clientId: process.env.AZURE_AD_CLIENT_ID,
      tenantId: process.env.AZURE_AD_TENANT_ID,
      authority: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}`,
    });
  });

  it('me returns the current user with a valid access token, 401 without', async () => {
    const { body } = await login('t4a_operator');
    const me = await http.get('/api/auth/me').set('Authorization', `Bearer ${body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body).toEqual(body.user);
    expect(me.body.permissions).toHaveLength(18);

    const anonymous = await http.get('/api/auth/me');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe('UNAUTHORIZED');
    expect((await http.get('/api/auth/me').set('Authorization', 'Bearer junk')).status).toBe(401);
  });
});

describe('refresh token rotation', () => {
  it('rotates: the new cookie works, the old one is spent', async () => {
    const a = refreshCookieOf(await login('t4a_viewer'));
    const first = await refreshWith(a);
    expect(first.status).toBe(200);
    expect(first.body.user.username).toBe('t4a_viewer');
    const b = refreshCookieOf(first);
    expect(b).not.toBe(a);
    expect((await refreshWith(b)).status).toBe(200);
  });

  it('reusing a token after the grace window revokes every session of the user', async () => {
    const a = refreshCookieOf(await login('t4a_viewer'));
    const b = refreshCookieOf(await refreshWith(a));
    await sql`update "RefreshTokens" set "ReplacedAt" = now() - interval '11 seconds', "RevokedAt" = now() - interval '11 seconds'
              where "ReplacedAt" is not null
                and "UserId" = (select "Id" from "Users" where "Username" = 't4a_viewer')`;
    const reuse = await refreshWith(a);
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('REFRESH_INVALID');
    expect((await refreshWith(b)).status).toBe(401);
  });

  it('two concurrent refreshes with the same cookie keep the session alive', async () => {
    const a = refreshCookieOf(await login('t4a_viewer'));
    const [x, y] = await Promise.all([refreshWith(a), refreshWith(a)]);
    expect([x.status, y.status].sort()).toEqual([200, 401]);
    const loser = x.status === 401 ? x : y;
    const winner = x.status === 200 ? x : y;
    expect(loser.body.code).toBe('REFRESH_RACE');
    expect((await refreshWith(refreshCookieOf(winner))).status).toBe(200);
  });

  it('no cookie, unknown token or expired token ⇒ 401 REFRESH_INVALID', async () => {
    expect((await http.post('/api/auth/refresh')).body.code).toBe('REFRESH_INVALID');
    expect((await refreshWith('refresh_token=unknown')).body.code).toBe('REFRESH_INVALID');
    const a = refreshCookieOf(await login('t4a_viewer'));
    await sql`update "RefreshTokens" set "ExpiresAt" = now() - interval '1 second'
              where "UserId" = (select "Id" from "Users" where "Username" = 't4a_viewer')`;
    expect((await refreshWith(a)).body.code).toBe('REFRESH_INVALID');
  });

  it('a disabled account cannot refresh', async () => {
    const a = refreshCookieOf(await login('t4a_viewer'));
    await sql`update "Users" set "Status" = 2 where "Username" = 't4a_viewer'`;
    try {
      const r = await refreshWith(a);
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('ACCOUNT_DISABLED');
    } finally {
      await sql`update "Users" set "Status" = 1 where "Username" = 't4a_viewer'`;
    }
  });
});

describe('logout and change-password', () => {
  it('logout revokes the cookie token and clears the cookie', async () => {
    const a = refreshCookieOf(await login('t4a_viewer'));
    const out = await http.post('/api/auth/logout').set('Cookie', a);
    expect(out.status).toBe(204);
    const cleared = ([] as string[]).concat(out.headers['set-cookie'] ?? []).find((c) => c.startsWith('refresh_token='));
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await refreshWith(a)).body.code).toBe('REFRESH_INVALID');
  });

  it('logout without a cookie is still 204', async () => {
    expect((await http.post('/api/auth/logout')).status).toBe(204);
  });

  it('change-password: wrong current password ⇒ 400; success revokes other sessions', async () => {
    const first = await login('t4a_operator');
    const otherSession = refreshCookieOf(await login('t4a_operator'));
    const auth = `Bearer ${first.body.accessToken}`;

    const wrong = await http
      .post('/api/auth/change-password')
      .set('Authorization', auth)
      .send({ oldPassword: 'nope', newPassword: 'New-Password-1' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('INVALID_CURRENT_PASSWORD');

    const short = await http
      .post('/api/auth/change-password')
      .set('Authorization', auth)
      .send({ oldPassword: PASSWORD, newPassword: 'short' });
    expect(short.body.code).toBe('VALIDATION_FAILED');

    const ok = await http
      .post('/api/auth/change-password')
      .set('Authorization', auth)
      .send({ oldPassword: PASSWORD, newPassword: 'New-Password-1' });
    expect(ok.status).toBe(204);
    expect((await refreshWith(otherSession)).status).toBe(401);
    expect((await login('t4a_operator', 'New-Password-1')).status).toBe(200);
    expect((await login('t4a_operator')).status).toBe(401);

    await sql`update "Users" set "PasswordHash" = ${await hashPassword(PASSWORD)} where "Username" = 't4a_operator'`;
  });
});

describe('guards', () => {
  const tokenOf = async (username: string) => `Bearer ${(await login(username)).body.accessToken}`;

  it('no token ⇒ 401', async () => {
    expect((await http.get('/api/guard-test/audit')).status).toBe(401);
  });

  // Get the token before building the next request: supertest starts/stops the server per request.
  const getAs = async (path: string, username: string) => {
    const token = await tokenOf(username);
    return http.get(path).set('Authorization', token);
  };

  it('missing permission ⇒ 403 FORBIDDEN (OPERATOR and ADMIN on audit:view)', async () => {
    for (const user of ['t4a_operator', 't4a_company']) {
      const r = await getAs('/api/guard-test/audit', user);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('FORBIDDEN');
    }
  });

  it('SUPER_ADMIN passes', async () => {
    expect((await getAs('/api/guard-test/audit', 't4a_admin')).status).toBe(200);
  });

  it('@LoginOnly lets any logged-in user through', async () => {
    expect((await getAs('/api/guard-test/login-only', 't4a_viewer')).status).toBe(200);
    expect((await http.get('/api/guard-test/login-only')).status).toBe(401);
  });

  it('a handler without a permission decorator is 403 even for SUPER_ADMIN', async () => {
    expect((await getAs('/api/guard-test/bare', 't4a_admin')).status).toBe(403);
  });
});

afterEach(() => {
  process.env.AUTH_PASSWORD_LOGIN_ENABLED = 'true';
});

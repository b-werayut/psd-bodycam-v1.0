import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
const PREFIX = 't7u_';

let ctx: HttpContext;
let sql: TestSql;
let http: ReturnType<typeof supertest>;
let ids: Map<string, bigint>;
let admin: string;

beforeAll(async () => {
  ctx = await bootHttpContext();
  sql = ctx.sql;
  http = supertest(ctx.app.getHttpServer());
});

beforeEach(async () => {
  await dropTestUsers(sql, [`${PREFIX}%`]);
  ids = await createTestUsers(
    sql,
    [
      { username: `${PREFIX}admin`, role: 'SUPER_ADMIN' },
      { username: `${PREFIX}viewer`, role: 'VIEWER' },
      { username: `${PREFIX}victim`, role: 'OPERATOR', email: 't7u_victim@example.test' },
    ],
    await hashPassword(PASSWORD),
  );
  admin = await bearerFor(http, `${PREFIX}admin`, PASSWORD);
});

afterAll(async () => {
  await dropTestUsers(sql, [`${PREFIX}%`]);
  await ctx.close();
});

const post = (body: object) => http.post('/api/users').set('Authorization', admin).send(body);

describe('POST /api/users', () => {
  it('creates TEAM_LEADER accounts without access to web administration', async () => {
    const username = `${PREFIX}teamleader`;
    const created = await post({ username, firstName: 'หัวหน้า', lastName: 'ทีม', roleCode: 'TEAM_LEADER', password: PASSWORD });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ roleId: '5', roleCode: 'TEAM_LEADER' });
    const login = await http.post('/api/auth/login').send({ username, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.permissions).toEqual(['streaming:view-live']);
    const authorization = `Bearer ${login.body.accessToken}`;
    for (const path of ['/api/users', '/api/settings', '/api/tracking/positions']) {
      expect((await http.get(path).set('Authorization', authorization)).status).toBe(403);
    }
  });
  it('creates a user with a normalized username and returns the row', async () => {
    const r = await post({ username: ' T7U_Bob ', firstName: 'Bob', lastName: 'Builder', roleCode: 'OPERATOR', password: 'Bob-Password-1' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      username: 't7u_bob',
      firstName: 'Bob', lastName: 'Builder',
      email: null,
      roleCode: 'OPERATOR',
      roleName: 'ผู้ปฏิบัติการ',
      status: 1,
      lastLoginAt: null,
      azureLinked: false,
    });
    expect(typeof r.body.id).toBe('string');
    expect(r.body).not.toHaveProperty('fullName');
    expect(typeof r.body.roleId).toBe('string');
    expect((await http.post('/api/auth/login').send({ username: 't7u_bob', password: 'Bob-Password-1' })).status).toBe(200);
  });

  it('without a password the account is SSO-only (cannot log in with a password)', async () => {
    const r = await post({ username: `${PREFIX}sso`, firstName: 'SSO', lastName: 'Only', roleCode: 'VIEWER', email: 'sso@example.test' });
    expect(r.status).toBe(201);
    const [row] = await sql`select "PasswordHash" from "Users" where "Username" = ${`${PREFIX}sso`}`;
    expect(row.PasswordHash).toBeNull();
  });

  it('duplicate username (any case) ⇒ 409 USERNAME_TAKEN; duplicate email ⇒ 409 EMAIL_TAKEN', async () => {
    const dupUser = await post({ username: 'T7U_VICTIM', firstName: 'x', lastName: '', roleCode: 'VIEWER', password: 'Some-Password-1' });
    expect(dupUser.status).toBe(409);
    expect(dupUser.body.code).toBe('USERNAME_TAKEN');
    const dupEmail = await post({ username: `${PREFIX}other`, firstName: 'x', lastName: '', roleCode: 'VIEWER', email: 'T7U_VICTIM@example.test' });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.code).toBe('EMAIL_TAKEN');
  });

  it('unknown role ⇒ 400 UNKNOWN_ROLE; short password ⇒ 400 VALIDATION_FAILED', async () => {
    expect((await post({ username: `${PREFIX}x`, firstName: 'x', lastName: '', roleCode: 'NOPE' })).body.code).toBe('UNKNOWN_ROLE');
    expect((await post({ username: `${PREFIX}x`, firstName: 'x', lastName: '', roleCode: 'VIEWER', password: 'short' })).body.code).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('GET /api/users', () => {
  it('does not expose the removed employees API', async () => {
    expect((await http.get('/api/employees').set('Authorization', admin)).status).toBe(404);
  });
  it('searches first name, surname, and the combined display name', async () => {
    const created = await post({ username: `${PREFIX}names`, firstName: 'สมชาย', lastName: 'ใจดี', roleCode: 'VIEWER' });
    expect(created.status).toBe(201);
    for (const q of ['สมชาย', 'ใจดี', 'สมชาย ใจดี']) {
      const r = await http.get('/api/users').query({ q }).set('Authorization', admin);
      expect(r.status).toBe(200);
      expect(r.body.data.map((u: { id: string }) => u.id)).toContain(created.body.id);
    }
  });

  it('returns the paged envelope with string ids and availableActions', async () => {
    const r = await http.get('/api/users').query({ q: PREFIX, pageSize: 50 }).set('Authorization', admin);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ page: 1, pageSize: 50, total: 3 });
    const self = r.body.data.find((u: { username: string }) => u.username === `${PREFIX}admin`);
    const victim = r.body.data.find((u: { username: string }) => u.username === `${PREFIX}victim`);
    expect(typeof victim.id).toBe('string');
    expect(victim.availableActions).toEqual(['edit', 'suspend', 'delete']);
    expect(self.availableActions).toEqual(['edit']);
  });

  it('filters by role and status', async () => {
    const r = await http.get('/api/users').query({ q: PREFIX, roleCode: 'VIEWER' }).set('Authorization', admin);
    expect(r.body.data.map((u: { username: string }) => u.username)).toEqual([`${PREFIX}viewer`]);
  });

  it('VIEWER has no users:read ⇒ 403', async () => {
    const viewer = await bearerFor(http, `${PREFIX}viewer`, PASSWORD);
    expect((await http.get('/api/users').set('Authorization', viewer)).status).toBe(403);
  });

  it('GET /api/users/:id returns one row; unknown id ⇒ 404; bad id ⇒ 400', async () => {
    const r = await http.get(`/api/users/${ids.get(`${PREFIX}victim`)}`).set('Authorization', admin);
    expect(r.status).toBe(200);
    expect(r.body.username).toBe(`${PREFIX}victim`);
    expect((await http.get('/api/users/999999999').set('Authorization', admin)).status).toBe(404);
    expect((await http.get('/api/users/abc').set('Authorization', admin)).status).toBe(400);
  });
});

describe('PATCH /api/users/:id', () => {
  it('renames an unlinked user even when it has email, preserving the ID and allowing the new login', async () => {
    const id = ids.get(`${PREFIX}victim`)!;
    const r = await http.patch(`/api/users/${id}`).set('Authorization', admin).send({ username: ' T7U_Renamed ' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: id.toString(), username: 't7u_renamed', email: 't7u_victim@example.test' });
    const login = await http.post('/api/auth/login').send({ username: 't7u_renamed', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(id.toString());
    expect((await http.post('/api/auth/login').send({ username: `${PREFIX}victim`, password: PASSWORD })).status).toBe(401);
  });

  it('rejects duplicate usernames case-insensitively and keeps Microsoft usernames locked', async () => {
    const id = ids.get(`${PREFIX}victim`)!;
    const duplicate = await http.patch(`/api/users/${id}`).set('Authorization', admin).send({ username: 'T7U_VIEWER' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('USERNAME_TAKEN');
    await sql`update "Users" set "AzureObjectId" = '11111111-2222-3333-4444-555555555555' where "Id" = ${id}`;
    for (const body of [{ username: 't7u_new' }, { username: 't7u_new', azureObjectId: null }]) {
      const linked = await http.patch(`/api/users/${id}`).set('Authorization', admin).send(body);
      expect(linked.status).toBe(409);
      expect(linked.body.code).toBe('MICROSOFT_USERNAME_READ_ONLY');
    }
    const [row] = await sql`select "Username" from "Users" where "Id" = ${id}`;
    expect(row.Username).toBe(`${PREFIX}victim`);
  });
  it('allows setting and clearing a phone for a Microsoft-managed account', async () => {
    const id = ids.get(`${PREFIX}victim`)!;
    const updated = await http.patch(`/api/users/${id}`).set('Authorization', admin).send({ phone: ' 0812345678 ' });
    expect(updated.status).toBe(200);
    expect(updated.body.phone).toBe('0812345678');
    const [row] = await sql`select "Phone" from "Users" where "Id" = ${id}`;
    expect(row.Phone).toBe('0812345678');
    const cleared = await http.patch(`/api/users/${id}`).set('Authorization', admin).send({ phone: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.phone).toBeNull();
  });
  it('rejects manual profile changes for accounts with email without writing any fields', async () => {
    const id = ids.get(`${PREFIX}victim`)!;
    for (const body of [
      { firstName: 'Changed' }, { lastName: 'Changed' }, { email: 'other@example.test' }, { email: null },
    ]) {
      const r = await http.patch(`/api/users/${id}`).set('Authorization', admin).send({ ...body, roleCode: 'VIEWER' });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('MICROSOFT_PROFILE_READ_ONLY');
    }
    const [row] = await sql`select "FirstName", "LastName", "Email", "RoleId" from "Users" where "Id" = ${id}`;
    expect(row).toMatchObject({ FirstName: 'Test', LastName: `${PREFIX}victim`, Email: 't7u_victim@example.test' });
    const current = await http.get(`/api/users/${id}`).set('Authorization', admin);
    expect(current.body.roleCode).toBe('OPERATOR');
  });

  it('protects linked Microsoft profiles even without email and allows unchanged fields plus role changes', async () => {
    const id = ids.get(`${PREFIX}viewer`)!;
    const oid = '11111111-2222-3333-4444-555555555555';
    await sql`update "Users" set "AzureObjectId" = ${oid} where "Id" = ${id}`;
    const changed = await http.patch(`/api/users/${id}`).set('Authorization', admin).send({ firstName: 'Changed' });
    expect(changed.status).toBe(409);
    const allowed = await http.patch(`/api/users/${id}`).set('Authorization', admin).send({
      firstName: 'Test', lastName: `${PREFIX}viewer`, email: null, roleCode: 'OPERATOR',
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.roleCode).toBe('OPERATOR');
  });

  it('updates name, email and role', async () => {
    await sql`update "Users" set "Email" = null where "Id" = ${ids.get(`${PREFIX}victim`)!}`;
    const r = await http
      .patch(`/api/users/${ids.get(`${PREFIX}victim`)}`)
      .set('Authorization', admin)
      .send({ firstName: 'Renamed', lastName: '', email: null, roleCode: 'VIEWER' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ firstName: 'Renamed', lastName: '', email: null, roleCode: 'VIEWER' });
  });

  it('a new password cuts every session of the user', async () => {
    const login = await http.post('/api/auth/login').send({ username: `${PREFIX}victim`, password: PASSWORD });
    const cookie = ([] as string[]).concat(login.headers['set-cookie']).find((c) => c.startsWith('refresh_token='))!.split(';')[0];
    const r = await http
      .patch(`/api/users/${ids.get(`${PREFIX}victim`)}`)
      .set('Authorization', admin)
      .send({ password: 'Reset-Password-1' });
    expect(r.status).toBe(200);
    expect((await http.post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    expect((await http.post('/api/auth/login').send({ username: `${PREFIX}victim`, password: 'Reset-Password-1' })).status).toBe(200);
  });
});

describe('PATCH /api/users/:id/access', () => {
  it('suspending yourself ⇒ 400 CANNOT_SUSPEND_SELF', async () => {
    const r = await http.patch(`/api/users/${ids.get(`${PREFIX}admin`)}/access`).set('Authorization', admin).send({ enabled: false });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('CANNOT_SUSPEND_SELF');
  });

  it('suspending someone revokes their refresh tokens; restoring lets them back in', async () => {
    const login = await http.post('/api/auth/login').send({ username: `${PREFIX}victim`, password: PASSWORD });
    const cookie = ([] as string[]).concat(login.headers['set-cookie']).find((c) => c.startsWith('refresh_token='))!.split(';')[0];
    const id = ids.get(`${PREFIX}victim`)!;

    const off = await http.patch(`/api/users/${id}/access`).set('Authorization', admin).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ userId: String(id), username: `${PREFIX}victim`, enabled: false, changed: true });
    expect(off.body.revokedSessions).toBeGreaterThanOrEqual(1);
    const [live] = await sql`select count(*)::int as n from "RefreshTokens" where "UserId" = ${id} and "RevokedAt" is null`;
    expect(live.n).toBe(0);
    expect((await http.post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    expect((await http.post('/api/auth/login').send({ username: `${PREFIX}victim`, password: PASSWORD })).body.code).toBe(
      'ACCOUNT_DISABLED',
    );

    const on = await http.patch(`/api/users/${id}/access`).set('Authorization', admin).send({ enabled: true });
    expect(on.body).toMatchObject({ enabled: true, changed: true });
    expect((await http.post('/api/auth/login').send({ username: `${PREFIX}victim`, password: PASSWORD })).status).toBe(200);
  });

  it('restoring also clears a password lockout', async () => {
    const id = ids.get(`${PREFIX}victim`)!;
    await sql`update "Users" set "FailedLoginCount" = 3, "LockedUntil" = now() + interval '15 minutes' where "Id" = ${id}`;
    await http.patch(`/api/users/${id}/access`).set('Authorization', admin).send({ enabled: true });
    expect((await http.post('/api/auth/login').send({ username: `${PREFIX}victim`, password: PASSWORD })).status).toBe(200);
  });
});

describe('DELETE /api/users/:id', () => {
  it('soft-deletes and frees the username', async () => {
    const id = ids.get(`${PREFIX}victim`)!;
    const r = await http.delete(`/api/users/${id}`).set('Authorization', admin);
    expect(r.status).toBe(204);
    const [user] = await sql`select "IsDeleted" from "Users" where "Id" = ${id}`;
    expect(user.IsDeleted).toBe(true);
    expect((await http.get(`/api/users/${id}`).set('Authorization', admin)).status).toBe(404);
    expect((await post({ username: `${PREFIX}victim`, firstName: 'again', lastName: '', roleCode: 'VIEWER', password: 'Again-Password-1' })).status).toBe(201);
  });

  it('deleting yourself ⇒ 400 CANNOT_DELETE_SELF', async () => {
    const r = await http.delete(`/api/users/${ids.get(`${PREFIX}admin`)}`).set('Authorization', admin);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('CANNOT_DELETE_SELF');
  });

  it('writes are audited', async () => {
    const created = await post({ username: `${PREFIX}audited`, firstName: 'x', lastName: '', roleCode: 'VIEWER', password: 'Audit-Password-1' });
    const row = await eventually(async () => {
      const [found] = await sql`select "Action", "Result", "ResourceType", "ResourceId", "Changes" from "AuditLogs"
                                where "Action" = 'CREATE_USER' and "ResourceId" = ${created.body.id}`;
      return found;
    });
    expect(row).toMatchObject({ Action: 'CREATE_USER', Result: 1, ResourceType: 'Users' });
    expect(row.Changes.password).toBe('[REDACTED]');
  });
});

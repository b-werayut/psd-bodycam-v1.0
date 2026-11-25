import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { bootHttpContext, eventually, type HttpContext, type TestSql } from '../../test/int-helpers';

const PASSWORD = 'Test@12345';
const USERS = [
  ['t6a_admin', 'SUPER_ADMIN'],
  ['t6a_company', 'ADMIN'],
  ['t6a_viewer', 'VIEWER'],
] as const;
const USERNAMES = USERS.map(([u]) => u);

let ctx: HttpContext;
let sql: TestSql;
let http: ReturnType<typeof supertest>;

const login = (username: string, password = PASSWORD) =>
  http.post('/api/auth/login').send({ username, password });
const tokenOf = async (username: string) => `Bearer ${(await login(username)).body.accessToken}`;

beforeAll(async () => {
  ctx = await bootHttpContext();
  sql = ctx.sql;
  http = supertest(ctx.app.getHttpServer());
  await sql`delete from "AuditLogs" where "ActorUsername" in ${sql(USERNAMES)}`;
  await sql`delete from "RefreshTokens" where "UserId" in (select "Id" from "Users" where "Username" in ${sql(USERNAMES)})`;
  await sql`delete from "Users" where "Username" in ${sql(USERNAMES)}`;
  const hash = await hashPassword(PASSWORD);
  for (const [username, role] of USERS) {
    await sql`insert into "Users" ("Username", "FirstName", "LastName", "RoleId", "PasswordHash")
              select ${username}, 'T6A', ${username}, r."Id", ${hash} from "Roles" r where r."Code" = ${role}`;
  }
});

afterAll(async () => {
  await sql`delete from "AuditLogs" where "ActorUsername" in ${sql(USERNAMES)}`;
  await sql`delete from "RefreshTokens" where "UserId" in (select "Id" from "Users" where "Username" in ${sql(USERNAMES)})`;
  await sql`delete from "Users" where "Username" in ${sql(USERNAMES)}`;
  await ctx.close();
});

describe('login audit trail', () => {
  it('records LOGIN and LOGIN_FAILED with the actor, IP and result', async () => {
    await login('t6a_viewer', 'wrong');
    await login('t6a_viewer');
    const rows = await eventually(async () => {
      const found = await sql`select "Action", "Result", "ActorUsername", "ActorRole", "Ip", "UserId" from "AuditLogs"
                              where "ActorUsername" = 't6a_viewer' order by "Id"`;
      return found.length >= 2 ? found : null;
    });
    expect(rows.map((r) => [r.Action, r.Result])).toEqual([
      ['LOGIN_FAILED', 2],
      ['LOGIN', 1],
    ]);
    expect(rows[1].ActorRole).toBe('VIEWER');
    expect(rows[1].UserId).not.toBeNull();
    expect(rows[1].Ip).toBeTruthy();
  });
});

describe('GET /api/audit-logs', () => {
  it('ADMIN is refused (audit:view is SUPER_ADMIN-only)', async () => {
    const token = await tokenOf('t6a_company');
    expect((await http.get('/api/audit-logs').set('Authorization', token)).status).toBe(403);
  });

  it('SUPER_ADMIN gets the paged envelope, newest first, with client field names', async () => {
    const token = await tokenOf('t6a_admin');
    const r = await http.get('/api/audit-logs').query({ search: 't6a_', pageSize: 5 }).set('Authorization', token);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ page: 1, pageSize: 5 });
    expect(r.body.total).toBeGreaterThanOrEqual(3);
    const [first] = r.body.data;
    expect(Object.keys(first).sort()).toEqual(
      [
        'id', 'occurredAt', 'userId', 'actorUsername', 'actorRole', 'action', 'resourceType',
        'resourceId', 'result', 'httpMethod', 'requestPath', 'ip', 'correlationId',
      ].sort(),
    );
    expect(typeof first.id).toBe('string');
    const times = r.body.data.map((row: { occurredAt: string }) => Date.parse(row.occurredAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('filters by action and result', async () => {
    const token = await tokenOf('t6a_admin');
    const r = await http
      .get('/api/audit-logs')
      .query({ action: 'LOGIN_FAILED', result: 2, search: 't6a_viewer' })
      .set('Authorization', token);
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThanOrEqual(1);
    for (const row of r.body.data) expect(row).toMatchObject({ action: 'LOGIN_FAILED', result: 2 });
  });

  it('pageSize above 100 is refused', async () => {
    const token = await tokenOf('t6a_admin');
    expect((await http.get('/api/audit-logs').query({ pageSize: 101 }).set('Authorization', token)).status).toBe(400);
  });

  it('lists the distinct actions', async () => {
    const token = await tokenOf('t6a_admin');
    const r = await http.get('/api/audit-logs/actions').set('Authorization', token);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual(expect.arrayContaining(['LOGIN', 'LOGIN_FAILED']));
    expect(r.body.total).toBe(r.body.data.length);
  });
});

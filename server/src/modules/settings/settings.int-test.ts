import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { bootHttpContext, eventually, type HttpContext, type TestSql } from '../../test/int-helpers';

const PASSWORD = 'Test@12345';
const USERS = [
  ['t6s_admin', 'ADMIN'],
  ['t6s_company', 'COMPANY_ADMIN'],
  ['t6s_target', 'VIEWER'],
] as const;
const USERNAMES = USERS.map(([u]) => u);

let ctx: HttpContext;
let sql: TestSql;
let http: ReturnType<typeof supertest>;

const tokenOf = async (username: string) => {
  const r = await http.post('/api/auth/login').send({ username, password: PASSWORD });
  return `Bearer ${r.body.accessToken}`;
};

const setSetting = (key: string, value: string) =>
  sql`update "Settings" set "SettingValue" = ${value} where "SettingKey" = ${key}`;

beforeAll(async () => {
  ctx = await bootHttpContext();
  sql = ctx.sql;
  http = supertest(ctx.app.getHttpServer());
  await sql`update "Settings" set "UpdatedBy" = null where "UpdatedBy" in (select "Id" from "Users" where "Username" in ${sql(USERNAMES)})`;
  await sql`delete from "RefreshTokens" where "UserId" in (select "Id" from "Users" where "Username" in ${sql(USERNAMES)})`;
  await sql`delete from "Users" where "Username" in ${sql(USERNAMES)}`;
  const hash = await hashPassword(PASSWORD);
  for (const [username, role] of USERS) {
    await sql`insert into "Users" ("Username", "FullName", "RoleId", "PasswordHash")
              select ${username}, ${'T6S ' + username}, r."Id", ${hash} from "Roles" r where r."Code" = ${role}`;
  }
});

afterAll(async () => {
  await setSetting('auth.max-failed-logins', '3');
  await setSetting('auth.lockout-minutes', '15');
  await sql`update "Settings" set "UpdatedBy" = null where "UpdatedBy" in (select "Id" from "Users" where "Username" in ${sql(USERNAMES)})`;
  await sql`delete from "RefreshTokens" where "UserId" in (select "Id" from "Users" where "Username" in ${sql(USERNAMES)})`;
  await sql`delete from "Users" where "Username" in ${sql(USERNAMES)}`;
  await ctx.close();
});

describe('GET /api/settings', () => {
  it('ADMIN sees the auth group with values, bounds and Thai descriptions', async () => {
    const token = await tokenOf('t6s_admin');
    const r = await http.get('/api/settings').set('Authorization', token);
    expect(r.status).toBe(200);
    const auth = r.body.groups.find((g: { category: string }) => g.category === 'auth');
    expect(auth.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'auth.max-failed-logins', value: '3', valueType: 2, min: 3, max: 20 }),
        expect.objectContaining({ key: 'auth.lockout-minutes', value: '15', valueType: 2, min: 1, max: 1440 }),
      ]),
    );
    for (const item of auth.items) expect(item.description).toMatch(/[ก-๙]/);
    expect(r.body.total).toBeGreaterThanOrEqual(2);
  });

  it('COMPANY_ADMIN is refused (settings:manage is ADMIN-only) and the refusal is audited', async () => {
    const token = await tokenOf('t6s_company');
    const r = await http.get('/api/settings').set('Authorization', token).set('X-Correlation-Id', 't6s-denied-1');
    expect(r.status).toBe(403);
    const row = await eventually(async () => {
      const [found] = await sql`select "Action", "Result", "ActorUsername", "RequestPath" from "AuditLogs"
                                where "CorrelationId" = 't6s-denied-1'`;
      return found;
    });
    expect(row).toMatchObject({ Action: 'ACCESS_DENIED', Result: 2, ActorUsername: 't6s_company', RequestPath: '/api/settings' });
  });
});

describe('PATCH /api/settings/:key', () => {
  it('ADMIN changes a value; the change is audited with the request correlation id', async () => {
    const token = await tokenOf('t6s_admin');
    const r = await http
      .patch('/api/settings/auth.lockout-minutes')
      .set('Authorization', token)
      .set('X-Correlation-Id', 't6s-update-1')
      .send({ value: '30' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ key: 'auth.lockout-minutes', value: '30', valueType: 2, min: 1, max: 1440 });

    const row = await eventually(async () => {
      const [found] = await sql`select "Action", "ResourceType", "Result", "Changes" from "AuditLogs"
                                where "CorrelationId" = 't6s-update-1'`;
      return found;
    });
    expect(row).toMatchObject({ Action: 'UPDATE_SETTING', ResourceType: 'Settings', Result: 1 });
    expect(row.Changes).toEqual({ value: '30' });
    await setSetting('auth.lockout-minutes', '15');
  });

  it('out of range ⇒ 400 SETTING_OUT_OF_RANGE with a Thai message; value unchanged', async () => {
    const token = await tokenOf('t6s_admin');
    const r = await http.patch('/api/settings/auth.max-failed-logins').set('Authorization', token).send({ value: '1' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('SETTING_OUT_OF_RANGE');
    expect(r.body.message).toContain('ไม่น้อยกว่า 3');
    const [row] = await sql`select "SettingValue" from "Settings" where "SettingKey" = 'auth.max-failed-logins'`;
    expect(row.SettingValue).toBe('3');
  });

  it('unknown key ⇒ 404', async () => {
    const token = await tokenOf('t6s_admin');
    expect((await http.patch('/api/settings/nope.key').set('Authorization', token).send({ value: '1' })).status).toBe(404);
  });

  it('COMPANY_ADMIN cannot change settings', async () => {
    const token = await tokenOf('t6s_company');
    const r = await http.patch('/api/settings/auth.max-failed-logins').set('Authorization', token).send({ value: '5' });
    expect(r.status).toBe(403);
  });

  it('the lockout follows the setting at once: ADMIN sets 5 attempts / 2 minutes', async () => {
    const token = await tokenOf('t6s_admin');
    await http.patch('/api/settings/auth.max-failed-logins').set('Authorization', token).send({ value: '5' });
    await http.patch('/api/settings/auth.lockout-minutes').set('Authorization', token).send({ value: '2' });

    const wrong = () => http.post('/api/auth/login').send({ username: 't6s_target', password: 'bad' });
    for (let i = 0; i < 4; i++) expect((await wrong()).body.code).toBe('INVALID_CREDENTIALS');
    const fifth = await wrong();
    expect(fifth.body.code).toBe('ACCOUNT_LOCKED_TEMPORARY');
    expect(fifth.body.details.retryAfterMinutes).toBe(2);

    await http.patch('/api/settings/auth.max-failed-logins').set('Authorization', token).send({ value: '3' });
    await http.patch('/api/settings/auth.lockout-minutes').set('Authorization', token).send({ value: '15' });
  });
});

import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import {
  bearerFor,
  bootHttpContext,
  createTestUsers,
  dropTestUsers,
  type HttpContext,
  type TestSql,
} from '../../test/int-helpers';

// Review Focus 3: COMPANY_ADMIN tries to escalate. Every attempt is refused and nothing changes.
const PASSWORD = 'Test@12345';
const PREFIX = 't7c_';

let ctx: HttpContext;
let sql: TestSql;
let http: ReturnType<typeof supertest>;
let ids: Map<string, bigint>;
let company: string;

const userRow = (id: bigint | undefined) =>
  sql`select u."FullName", u."Status", u."IsDeleted", r."Code" as "RoleCode" from "Users" u
      join "Roles" r on r."Id" = u."RoleId" where u."Id" = ${id ?? 0n}`.then(([row]) => row);

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
      { username: `${PREFIX}admin`, role: 'ADMIN' },
      { username: `${PREFIX}company`, role: 'COMPANY_ADMIN' },
      { username: `${PREFIX}operator`, role: 'OPERATOR' },
    ],
    await hashPassword(PASSWORD),
  );
  company = await bearerFor(http, `${PREFIX}company`, PASSWORD);
});

afterAll(async () => {
  await dropTestUsers(sql, [`${PREFIX}%`]);
  await ctx.close();
});

describe('COMPANY_ADMIN never sees ADMIN accounts', () => {
  it('GET /users leaves ADMIN rows out of data and total', async () => {
    const r = await http.get('/api/users').query({ q: PREFIX }).set('Authorization', company);
    expect(r.status).toBe(200);
    expect(r.body.data.map((u: { username: string }) => u.username).sort()).toEqual([`${PREFIX}company`, `${PREFIX}operator`]);
    expect(r.body.total).toBe(2);
    expect(r.body.data.every((u: { roleCode: string }) => u.roleCode !== 'ADMIN')).toBe(true);
  });

  it('filtering by roleCode=ADMIN finds nothing', async () => {
    const r = await http.get('/api/users').query({ roleCode: 'ADMIN' }).set('Authorization', company);
    expect(r.body).toMatchObject({ data: [], total: 0 });
  });

  it('every /users/:id route on an ADMIN account ⇒ 404 and the row is unchanged', async () => {
    const id = ids.get(`${PREFIX}admin`);
    const before = await userRow(id);
    const responses = [
      await http.get(`/api/users/${id}`).set('Authorization', company),
      await http.patch(`/api/users/${id}`).set('Authorization', company).send({ fullName: 'pwned' }),
      await http.patch(`/api/users/${id}/access`).set('Authorization', company).send({ enabled: false }),
      await http.delete(`/api/users/${id}`).set('Authorization', company),
    ];
    for (const r of responses) {
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('NOT_FOUND');
    }
    expect(await userRow(id)).toEqual(before);
  });
});

describe('COMPANY_ADMIN cannot hand out ADMIN', () => {
  it('POST /users with roleCode ADMIN ⇒ 403 ADMIN_ACCOUNT_PROTECTED, nothing created', async () => {
    const r = await http
      .post('/api/users')
      .set('Authorization', company)
      .send({ username: `${PREFIX}evil`, fullName: 'Evil', roleCode: 'ADMIN', password: 'Evil-Password-1' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('ADMIN_ACCOUNT_PROTECTED');
    expect(await sql`select 1 from "Users" where "Username" = ${`${PREFIX}evil`}`).toHaveLength(0);
  });

  it('promoting yourself or someone else to ADMIN ⇒ 403, role unchanged', async () => {
    for (const target of [`${PREFIX}company`, `${PREFIX}operator`]) {
      const r = await http.patch(`/api/users/${ids.get(target)}`).set('Authorization', company).send({ roleCode: 'ADMIN' });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('ADMIN_ACCOUNT_PROTECTED');
    }
    expect((await userRow(ids.get(`${PREFIX}company`))).RoleCode).toBe('COMPANY_ADMIN');
    expect((await userRow(ids.get(`${PREFIX}operator`))).RoleCode).toBe('OPERATOR');
  });
});

describe('roles as seen by COMPANY_ADMIN', () => {
  it('GET /roles has no ADMIN and lists the 3 reserved permissions', async () => {
    const r = await http.get('/api/roles').set('Authorization', company);
    expect(r.status).toBe(200);
    expect(r.body.data.map((role: { code: string }) => role.code).sort()).toEqual(['COMPANY_ADMIN', 'OPERATOR', 'VIEWER']);
    expect(r.body.reservedPermissions).toEqual(['audit:view', 'settings:manage', 'roles:manage']);
  });

  it('cannot read the ADMIN role permissions (404) nor change any role (403, no roles:manage)', async () => {
    const [adminRole] = await sql`select "Id" from "Roles" where "Code" = 'ADMIN'`;
    const [operatorRole] = await sql`select "Id" from "Roles" where "Code" = 'OPERATOR'`;
    expect((await http.get(`/api/roles/${adminRole.Id}/permissions`).set('Authorization', company)).status).toBe(404);
    const put = await http
      .put(`/api/roles/${operatorRole.Id}/permissions`)
      .set('Authorization', company)
      .send({ permissions: ['dashboard:view'] });
    expect(put.status).toBe(403);
  });
});

describe('what COMPANY_ADMIN may do', () => {
  it('creates and suspends an OPERATOR', async () => {
    const created = await http
      .post('/api/users')
      .set('Authorization', company)
      .send({ username: `${PREFIX}newop`, fullName: 'New Op', roleCode: 'OPERATOR', password: 'NewOp-Password-1' });
    expect(created.status).toBe(201);
    const off = await http.patch(`/api/users/${created.body.id}/access`).set('Authorization', company).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);
  });
});

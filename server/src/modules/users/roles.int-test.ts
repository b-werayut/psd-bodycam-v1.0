import supertest from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { ROLE_PERMISSIONS } from '../../common/auth/permission-catalog';
import {
  bearerFor,
  bootHttpContext,
  createTestUsers,
  dropTestUsers,
  type HttpContext,
  type TestSql,
} from '../../test/int-helpers';

const PASSWORD = 'Test@12345';
const PREFIX = 't7r_';

let ctx: HttpContext;
let sql: TestSql;
let http: ReturnType<typeof supertest>;
let admin: string;
let roleId: Record<string, string>;

const operatorGrants = async () =>
  (
    await sql`select p."Code" from "RolePermissions" rp join "Permissions" p on p."Id" = rp."PermissionId"
              where rp."RoleId" = ${roleId.OPERATOR} order by p."Code"`
  ).map((r) => r.Code as string);

beforeAll(async () => {
  ctx = await bootHttpContext();
  sql = ctx.sql;
  http = supertest(ctx.app.getHttpServer());
  await createTestUsers(sql, [{ username: `${PREFIX}admin`, role: 'ADMIN' }], await hashPassword(PASSWORD));
  admin = await bearerFor(http, `${PREFIX}admin`, PASSWORD);
  roleId = Object.fromEntries(
    (await sql`select "Id", "Code" from "Roles"`).map((r) => [r.Code as string, String(r.Id)]),
  );
});

afterEach(async () => {
  // Put OPERATOR back to its catalog grants.
  await sql`delete from "RolePermissions" where "RoleId" = ${roleId.OPERATOR}`;
  await sql`insert into "RolePermissions" ("RoleId", "PermissionId")
            select ${roleId.OPERATOR}, "Id" from "Permissions" where "Code" in ${sql([...ROLE_PERMISSIONS.OPERATOR])}`;
});

afterAll(async () => {
  await dropTestUsers(sql, [`${PREFIX}%`]);
  await ctx.close();
});

describe('roles API (ADMIN)', () => {
  it('GET /roles lists all 4 roles with string ids', async () => {
    const r = await http.get('/api/roles').set('Authorization', admin);
    expect(r.status).toBe(200);
    expect(r.body.data.map((x: { code: string }) => x.code).sort()).toEqual(['ADMIN', 'COMPANY_ADMIN', 'OPERATOR', 'VIEWER']);
    expect(r.body.data[0]).toEqual({ id: expect.any(String), code: expect.any(String), name: expect.any(String), isSystem: true });
    expect(r.body.total).toBe(4);
  });

  it('GET /roles/:id/permissions returns the grants in catalog order', async () => {
    const r = await http.get(`/api/roles/${roleId.OPERATOR}/permissions`).set('Authorization', admin);
    expect(r.body).toEqual({ data: [...ROLE_PERMISSIONS.OPERATOR], total: 18 });
    expect((await http.get('/api/roles/999999/permissions').set('Authorization', admin)).status).toBe(404);
  });

  it('PUT replaces the grants; GET returns the new set; the change is audited', async () => {
    const r = await http
      .put(`/api/roles/${roleId.OPERATOR}/permissions`)
      .set('Authorization', admin)
      .send({ permissions: ['tracking:view', 'dashboard:view', 'dashboard:view'] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ data: ['dashboard:view', 'tracking:view'], total: 2 });
    expect(await operatorGrants()).toEqual(['dashboard:view', 'tracking:view']);
  });

  it('a reserved permission for OPERATOR ⇒ 400 PERMISSION_RESERVED_FOR_ADMIN; grants unchanged', async () => {
    const before = await operatorGrants();
    const r = await http
      .put(`/api/roles/${roleId.OPERATOR}/permissions`)
      .set('Authorization', admin)
      .send({ permissions: ['dashboard:view', 'audit:view'] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PERMISSION_RESERVED_FOR_ADMIN');
    expect(await operatorGrants()).toEqual(before);
  });

  it('the ADMIN role cannot be edited ⇒ 400 ROLE_IMMUTABLE', async () => {
    const r = await http.put(`/api/roles/${roleId.ADMIN}/permissions`).set('Authorization', admin).send({ permissions: [] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('ROLE_IMMUTABLE');
  });

  it('a code outside the catalog ⇒ 400 UNKNOWN_PERMISSION', async () => {
    const r = await http
      .put(`/api/roles/${roleId.OPERATOR}/permissions`)
      .set('Authorization', admin)
      .send({ permissions: ['x:y', 'sessions:read'] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('UNKNOWN_PERMISSION');
    expect(r.body.details).toEqual({ permissions: ['x:y', 'sessions:read'] });
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootHttpContext, eventually, type HttpContext } from '../test/int-helpers';

function yyyymm(offsetMonths: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

describe('P0 schema', () => {
  let ctx: HttpContext;
  let roleId: bigint;
  let deptId: bigint;

  beforeAll(async () => {
    ctx = await bootHttpContext();
    const [role] = await ctx.sql`
      insert into "Roles" ("Code","Name") values ('T4_ROLE','Task4 role')
      on conflict ("Code") do update set "Name" = excluded."Name" returning "Id"`;
    roleId = role.Id;
    const [dept] = await ctx.sql`
      insert into "Departments" ("Code","Name") values ('T4_DEPT','Task4 dept')
      on conflict do nothing returning "Id"`;
    deptId =
      dept?.Id ??
      (await ctx.sql`select "Id" from "Departments" where "Code" = 'T4_DEPT' and "IsDeleted" = false`)[0].Id;
  });

  beforeEach(async () => {
    await ctx.sql`delete from "Employees" where "EmployeeCode" like 'T4_%'`;
    await ctx.sql`delete from "Users" where "FullName" like 'T4 %'`;
  });

  afterAll(async () => {
    await ctx.sql`delete from "Employees" where "EmployeeCode" like 'T4_%'`;
    await ctx.sql`delete from "Users" where "FullName" like 'T4 %'`;
    await ctx.sql`delete from "Departments" where "Code" = 'T4_DEPT'`;
    await ctx.sql`delete from "Roles" where "Code" = 'T4_ROLE'`;
    await ctx.close();
  });

  const insertUser = async (username: string) => {
    const [row] = await ctx.sql`
      insert into "Users" ("Username","FullName","RoleId")
      values (${username}, ${'T4 ' + username}, ${roleId}) returning "Id"`;
    return row.Id as bigint;
  };
  const softDeleteUser = (username: string) =>
    ctx.sql`update "Users" set "IsDeleted" = true, "DeletedAt" = now() where lower("Username") = ${username}`;

  it('has btree_gist', async () => {
    expect(await ctx.sql`select 1 from pg_extension where extname = 'btree_gist'`).toHaveLength(1);
  });

  it('AuditLogs is partitioned with current, +1, +2 month and default partitions', async () => {
    const parts = await ctx.sql`
      select c.relname from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
      join pg_class p on p.oid = i.inhparent
      where p.relname = 'AuditLogs'`;
    expect(parts.map((p) => p.relname)).toEqual(
      expect.arrayContaining([
        'AuditLogs_default',
        `AuditLogs_${yyyymm(0)}`,
        `AuditLogs_${yyyymm(1)}`,
        `AuditLogs_${yyyymm(2)}`,
      ]),
    );
  });

  it('AuditLogs accepts rows, routes them to the month partition and auto-generates Id', async () => {
    const [row] = await ctx.sql`
      insert into "AuditLogs" ("Action","CorrelationId") values ('t4.probe','t4-corr-0001')
      returning "Id", tableoid::regclass::text as part`;
    expect(typeof row.Id).toBe('bigint');
    expect(row.part).toBe(`"AuditLogs_${yyyymm(0)}"`);
    await ctx.sql`delete from "AuditLogs" where "Action" = 't4.probe'`;
  });

  it('username is unique case-insensitively among live rows only', async () => {
    await insertUser('alice');
    await expect(insertUser('ALICE')).rejects.toThrow(/UQ_Users_Username/);
    await softDeleteUser('alice');
    await expect(insertUser('alice')).resolves.toBeDefined();
  });

  it('employee can link to at most one user', async () => {
    const userId = await insertUser('bob');
    const insertEmployee = (code: string) =>
      ctx.sql`
        insert into "Employees" ("EmployeeCode","FirstName","LastName","DepartmentId","UserId")
        values (${code}, 'T4', 'Emp', ${deptId}, ${userId})`;
    await insertEmployee('T4_E1');
    await expect(insertEmployee('T4_E2')).rejects.toThrow(/UQ_Employees_User/);
  });

  it('harness: boots the app over HTTP and reads BigInt through the test sql', async () => {
    const res = await eventually(async () => {
      const r = await ctx.http.get('/api/health');
      return r.status === 200 ? r : null;
    });
    expect(res.body).toEqual({ status: 'ok' });
    const [row] = await ctx.sql`select 1::bigint as n`;
    expect(row.n).toBe(1n);
  });
});

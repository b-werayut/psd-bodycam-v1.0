import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { expect, it } from 'vitest';

const statements = readFileSync('drizzle/0010_canonical_roles.sql', 'utf8').split('--> statement-breakpoint');

async function fixture(tx: postgres.TransactionSql) {
  await tx`create temporary table "Roles" (
    "Id" bigint generated always as identity primary key, "Code" varchar(30) unique,
    "Name" varchar(100), "Description" varchar(300), "IsSystem" boolean, "UpdatedAt" timestamptz
  ) on commit drop`;
  await tx`create temporary table "Permissions" ("Id" bigint primary key, "Code" text unique) on commit drop`;
  await tx`create temporary table "RolePermissions" (
    "RoleId" bigint references "Roles"("Id"), "PermissionId" bigint references "Permissions"("Id"),
    primary key ("RoleId", "PermissionId")
  ) on commit drop`;
  await tx`create temporary table "Users" ("Id" bigint primary key, "RoleId" bigint references "Roles"("Id")) on commit drop`;
  await tx`insert into "Roles" ("Id", "Code", "Name", "IsSystem") overriding system value values
    (1, 'ADMIN', 'old super', true), (2, 'COMPANY_ADMIN', 'old admin', true),
    (3, 'OPERATOR', 'operator', true), (4, 'VIEWER', 'viewer', true)`;
  await tx`insert into "Permissions" values (1, 'dashboard:view'), (2, 'users:manage'), (3, 'streaming:view-live')`;
  await tx`insert into "RolePermissions" values (1, 1), (1, 2), (2, 2), (3, 1), (4, 1)`;
  await tx`insert into "Users" values (101, 1), (102, 2), (103, 3), (104, 4)`;
}

it('renames roles in place, adds TEAMLEADER as 5, and preserves user bindings and customized grants', async () => {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      await fixture(tx);
      const users = await tx`select * from "Users" order by "Id"`;
      const grants = await tx`select * from "RolePermissions" order by "RoleId", "PermissionId"`;
      for (const statement of statements) await tx.unsafe(statement);
      expect((await tx`select "Id"::text as id, "Code" as code from "Roles" order by "Id"`)).toEqual([
        { id: '1', code: 'SUPERADMIN' }, { id: '2', code: 'ADMIN' }, { id: '3', code: 'OPERATOR' },
        { id: '4', code: 'VIEWER' }, { id: '5', code: 'TEAMLEADER' },
      ]);
      expect(await tx`select * from "Users" order by "Id"`).toEqual(users);
      expect(await tx`select * from "RolePermissions" where "RoleId" <> 5 order by "RoleId", "PermissionId"`).toEqual(grants);
      await tx`delete from "RolePermissions" where "RoleId" = 5`;
      await tx`insert into "RolePermissions" values (3, 3)`;
      const customized = await tx`select * from "RolePermissions" order by "RoleId", "PermissionId"`;
      for (const statement of statements) await tx.unsafe(statement);
      expect(await tx`select * from "RolePermissions" order by "RoleId", "PermissionId"`).toEqual(customized);
      const [next] = await tx`insert into "Roles" ("Code") values ('TEST_ROLE') returning "Id"::text as id`;
      expect(next.id).toBe('6');
    });
  } finally { await sql.end(); }
});

it('rejects unexpected role IDs before modifying their meaning', async () => {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });
  try {
    await expect(sql.begin(async (tx) => {
      await fixture(tx);
      await tx`update "Roles" set "Code" = 'OTHER' where "Id" = 1`;
      for (const statement of statements) await tx.unsafe(statement);
    })).rejects.toThrow('Role IDs do not match the expected mapping');
  } finally { await sql.end(); }
});

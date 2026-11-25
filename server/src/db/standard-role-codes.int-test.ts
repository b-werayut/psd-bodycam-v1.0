import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { expect, it } from 'vitest';

it('standardizes role codes without changing users, customized grants or IDs and supports replay', async () => {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      await tx`create temporary table "Roles" ("Id" bigint primary key, "Code" varchar(30) unique, "Description" text, "UpdatedAt" timestamptz) on commit drop`;
      await tx`create temporary table "Users" ("Id" bigint primary key, "RoleId" bigint references "Roles"("Id")) on commit drop`;
      await tx`create temporary table "RolePermissions" ("RoleId" bigint references "Roles"("Id"), "PermissionId" bigint) on commit drop`;
      await tx`insert into "Roles" ("Id", "Code", "Description") values
        (1, 'SUPERADMIN', 'SUPERADMIN'), (2, 'ADMIN', 'ADMIN'), (3, 'OPERATOR', 'OPERATOR'),
        (4, 'VIEWER', 'VIEWER'), (5, 'TEAMLEADER', 'TEAMLEADER')`;
      await tx`insert into "Users" values (101, 1), (102, 2), (105, 5)`;
      await tx`insert into "RolePermissions" values (1, 1), (1, 9), (2, 3), (3, 7), (5, 4)`;
      const users = await tx`select * from "Users" order by "Id"`;
      const grants = await tx`select * from "RolePermissions" order by "RoleId", "PermissionId"`;
      const statements = readFileSync('drizzle/0011_standard_role_codes.sql', 'utf8').split('--> statement-breakpoint');
      for (let run = 0; run < 2; run++) {
        for (const statement of statements) await tx.unsafe(statement);
        expect(await tx`select "Id"::text as id, "Code" as code from "Roles" order by "Id"`).toEqual([
          { id: '1', code: 'SUPER_ADMIN' }, { id: '2', code: 'ADMIN' }, { id: '3', code: 'OPERATOR' },
          { id: '4', code: 'VIEWER' }, { id: '5', code: 'TEAM_LEADER' },
        ]);
        expect(await tx`select * from "Users" order by "Id"`).toEqual(users);
        expect(await tx`select * from "RolePermissions" order by "RoleId", "PermissionId"`).toEqual(grants);
      }
    });
  } finally { await sql.end(); }
});

import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { expect, it } from 'vitest';

it('migrates existing names without truncation and removes the combined column', async () => {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      // A temporary table shadows public.Users, isolating the migration from application data.
      await tx`create temporary table "Users" ("Id" integer, "FullName" varchar(200) not null) on commit drop`;
      const cases = [
        { Id: 1, FullName: 'สมชาย ใจดี', FirstName: 'สมชาย', LastName: 'ใจดี' },
        { Id: 2, FullName: '  Mary   van der Berg  ', FirstName: 'Mary', LastName: 'van der Berg' },
        { Id: 3, FullName: 'ผู้ดูแลระบบ', FirstName: 'ผู้ดูแลระบบ', LastName: '' },
        { Id: 4, FullName: '\tFirst\tLast\n', FirstName: 'First', LastName: 'Last' },
        { Id: 5, FullName: 'ก'.repeat(200), FirstName: 'ก'.repeat(200), LastName: '' },
        { Id: 6, FullName: 'A ' + 'b'.repeat(198), FirstName: 'A', LastName: 'b'.repeat(198) },
        { Id: 7, FullName: '   ', FirstName: '', LastName: '' },
      ];
      for (const row of cases) await tx`insert into "Users" values (${row.Id}, ${row.FullName})`;
      const migration = readFileSync('drizzle/0007_user_names.sql', 'utf8');
      for (const statement of migration.split('--> statement-breakpoint')) await tx.unsafe(statement);
      expect(await tx`select * from "Users" order by "Id"`).toEqual(
        cases.map(({ Id, FirstName, LastName }) => ({ Id, FirstName, LastName })),
      );
      const columns = await tx`
        select attname, attnotnull from pg_attribute
        where attrelid = 'pg_temp."Users"'::regclass and attnum > 0 and not attisdropped`;
      expect(columns).toEqual(expect.arrayContaining([
        { attname: 'FirstName', attnotnull: true },
        { attname: 'LastName', attnotnull: true },
      ]));
      expect(columns.map((c) => c.attname)).not.toContain('FullName');
    });
  } finally {
    await sql.end();
  }
});

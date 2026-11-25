import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { expect, it } from 'vitest';

const migration = (name: string) => readFileSync(`drizzle/${name}.sql`, 'utf8').split('--> statement-breakpoint');

async function fixture(tx: postgres.TransactionSql, unlinkedMember = false) {
  await tx`create temporary table "Users" ("Id" bigint primary key, "Username" text, "IsDeleted" boolean not null default false) on commit drop`;
  await tx`create temporary table "Employees" ("Id" bigint primary key, "UserId" bigint references "Users"("Id"), "Phone" varchar(30), "BookingEmployeeRef" varchar(64), "IsDeleted" boolean not null default false) on commit drop`;
  await tx`create temporary table "TeamMembers" ("Id" bigint primary key, "EmployeeId" bigint not null references "Employees"("Id"), "ValidFrom" timestamptz, "ValidTo" timestamptz) on commit drop`;
  await tx`create unique index "UQ_TeamMembers_ActiveEmployee" on "TeamMembers" ("EmployeeId") where "ValidTo" is null`;
  await tx`insert into "Users" ("Id", "Username") values (7, 'somchai')`;
  await tx`insert into "Employees" ("Id", "UserId", "Phone", "BookingEmployeeRef") values (70, 7, '0812345678', 'booking-person-7'), (71, null, null, null)`;
  await tx`insert into "TeamMembers" values (1, ${unlinkedMember ? 71 : 70}, '2026-01-01T00:00:00Z', null)`;
}

it('preserves linked phones, external references and team history while dropping Employees', async () => {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      await fixture(tx);
      for (const statement of migration('0008_user_phone')) await tx.unsafe(statement);
      for (const statement of migration('0009_users_replace_employees')) await tx.unsafe(statement);
      const [user] = await tx`select "Username", "Phone", "BookingEmployeeRef" from "Users" where "Id" = 7`;
      expect(user).toEqual({ Username: 'somchai', Phone: '0812345678', BookingEmployeeRef: 'booking-person-7' });
      const [member] = await tx`select "UserId"::text as "UserId", "ValidFrom" from "TeamMembers" where "Id" = 1`;
      expect(member).toEqual({ UserId: '7', ValidFrom: new Date('2026-01-01T00:00:00Z') });
      const [table] = await tx`select to_regclass('pg_temp."Employees"') as name`;
      expect(table.name).toBeNull();
    });
  } finally { await sql.end(); }
});

it('aborts before dropping data when a team member has no linked user', async () => {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });
  try {
    await expect(sql.begin(async (tx) => {
      await fixture(tx, true);
      for (const statement of migration('0009_users_replace_employees')) await tx.unsafe(statement);
    })).rejects.toThrow('link every team member to a user account first');
  } finally { await sql.end(); }
});

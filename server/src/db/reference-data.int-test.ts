import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import {
  PERMISSION_CODES,
  ROLE_CODES,
  ROLE_NAMES_TH,
  ROLE_PERMISSIONS,
} from '../common/auth/permission-catalog';

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, onnotice: () => {} });

const MIGRATION = join(__dirname, '..', '..', 'drizzle', '0003_reference_data.sql');

const dbRolePermissions = async (role: string) =>
  (
    await sql`
      select p."Code" from "RolePermissions" rp
      join "Roles" r on r."Id" = rp."RoleId"
      join "Permissions" p on p."Id" = rp."PermissionId"
      where r."Code" = ${role} order by p."Code"`
  ).map((r) => r.Code as string);

const settingValue = async (key: string) =>
  (await sql`select "SettingValue" from "Settings" where "SettingKey" = ${key}`)[0]?.SettingValue;

const counts = async () =>
  (
    await sql`
      select (select count(*) from "Roles")::int as roles,
             (select count(*) from "Permissions")::int as permissions,
             (select count(*) from "RolePermissions")::int as "rolePermissions",
             (select count(*) from "Settings")::int as settings`
  )[0];

describe('reference data migration 0003', () => {
  afterAll(async () => {
    await sql.end();
  });

  it('ships the 4 P0 roles as system roles with Thai names', async () => {
    const rows = await sql`select "Code", "Name", "IsSystem" from "Roles" order by "Code"`;
    expect(rows.map((r) => r.Code)).toEqual([...ROLE_CODES].sort());
    for (const row of rows) {
      expect(row.Name).toBe(ROLE_NAMES_TH[row.Code as keyof typeof ROLE_NAMES_TH]);
      expect(row.IsSystem).toBe(true);
    }
  });

  it('ships exactly the code catalog, with Resource / Action split at ":"', async () => {
    const rows = await sql`select "Code", "Resource", "Action" from "Permissions" order by "Code"`;
    expect(rows.map((r) => r.Code)).toEqual([...PERMISSION_CODES].sort());
    for (const row of rows) expect(`${row.Resource}:${row.Action}`).toBe(row.Code);
  });

  it('grants each role exactly its catalog permissions', async () => {
    for (const role of ROLE_CODES) {
      expect(await dbRolePermissions(role)).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
  });

  it('ships the lockout settings', async () => {
    expect(await settingValue('auth.max-failed-logins')).toBe('3');
    expect(await settingValue('auth.lockout-minutes')).toBe('15');
    const rows = await sql`select "ValueType", "Category" from "Settings" where "SettingKey" like 'auth.%'`;
    for (const row of rows) {
      expect(row.ValueType).toBe(2);
      expect(row.Category).toBe('auth');
    }
  });

  it('is idempotent: running the SQL again changes nothing', async () => {
    const before = await counts();
    const statements = readFileSync(MIGRATION, 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) await sql.unsafe(statement);
    expect(await counts()).toEqual(before);
  });
});

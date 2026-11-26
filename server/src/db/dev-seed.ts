import type { Sql } from 'postgres';
import { hashPassword } from '../common/auth/password';
import type { RoleCode } from '../common/auth/permission-catalog';
import { normalizeUsername } from '../common/auth/username';

// Dev-only demo data for this system (no data from the old system — DL19).
// Roles / permissions / settings are NOT seeded here: they ship in drizzle/0003_reference_data.sql.

type Env = Record<string, string | undefined>;

export type SeedUser = { username: string; firstName: string; lastName: string; role: RoleCode; bookingEmployeeRef?: string };
export const SEED_USERS: readonly SeedUser[] = [
  { username: 'admin', firstName: 'ผู้ดูแลระบบ', lastName: '', role: 'SUPER_ADMIN' },
  { username: 'companyadmin1', firstName: 'ผู้ดูแลบริษัท', lastName: 'ทดสอบ', role: 'ADMIN' },
  { username: 'operator1', firstName: 'สมชาย', lastName: 'ใจดี', role: 'OPERATOR' },
  { username: 'viewer1', firstName: 'ผู้ดูข้อมูล', lastName: 'ทดสอบ', role: 'VIEWER' },
  { username: 'teamleader1', firstName: 'สมหญิง', lastName: 'รักงาน', role: 'TEAM_LEADER', bookingEmployeeRef: 'BK-EMP-0002' },
];

export type SeedDepot = { code: string; name: string; lat: number; lng: number; radiusM: number };

/** Mock charging bases (Q22): production has none until a depot screen exists (DL53). */
export const SEED_DEPOTS: readonly SeedDepot[] = [
  { code: 'DEPOT-01', name: 'ฐานสำนักงาน (ทดสอบ)', lat: 13.7563, lng: 100.5018, radiusM: 150 },
  { code: 'DEPOT-02', name: 'ฐานจตุจักร (ทดสอบ)', lat: 13.8, lng: 100.55, radiusM: 150 },
];

export const DEFAULT_ADMIN_PASSWORD = 'Admin@12345';
export const DEFAULT_DEMO_PASSWORD = 'Demo@12345';

export function assertSeedAllowed(env: Env): void {
  if ((env.NODE_ENV ?? '').trim() === 'production') {
    throw new Error('db:seed is for dev machines only - refused when NODE_ENV=production');
  }
}

export function seedPassword(role: RoleCode, env: Env): string {
  const value = role === 'SUPER_ADMIN' ? env.SEED_ADMIN_PASSWORD : env.SEED_DEMO_PASSWORD;
  if (value && value.trim()) return value;
  return role === 'SUPER_ADMIN' ? DEFAULT_ADMIN_PASSWORD : DEFAULT_DEMO_PASSWORD;
}

/**
 * Upserts the demo users in one transaction. Re-running resets the demo
 * accounts (role, password, active, unlocked) so the seed doubles as "reset dev logins".
 */
export async function runDevSeed(
  sql: Sql,
  env: Env,
): Promise<{ users: number; depots: number }> {
  assertSeedAllowed(env);

  // Hash outside the transaction: argon2 is slow on purpose.
  const users = await Promise.all(
    SEED_USERS.map(async (u) => ({
      ...u,
      username: normalizeUsername(u.username),
      passwordHash: await hashPassword(seedPassword(u.role, env)),
    })),
  );

  await sql.begin(async (tx) => {
    const roleCodes = [...new Set(users.map((u) => u.role))];
    const roles = await tx`select "Id", "Code" from "Roles" where "Code" in ${tx(roleCodes)}`;
    const roleId = new Map(roles.map((r) => [r.Code as string, r.Id]));
    const missing = roleCodes.filter((c) => !roleId.has(c));
    if (missing.length) {
      throw new Error(`Role not found: ${missing.join(', ')} - run npm run db:migrate before db:seed`);
    }

    for (const u of users) {
      const [existing] = await tx`
        select "Id" from "Users" where lower("Username") = ${u.username} and "IsDeleted" = false`;
      if (existing) {
        await tx`
          update "Users" set "FirstName" = ${u.firstName}, "LastName" = ${u.lastName},
            "BookingEmployeeRef" = ${u.bookingEmployeeRef ?? null},
            "RoleId" = ${roleId.get(u.role)}, "PasswordHash" = ${u.passwordHash},
            "Status" = 1, "FailedLoginCount" = 0, "LockedUntil" = null, "UpdatedAt" = now()
          where "Id" = ${existing.Id}`;
      } else {
        await tx`
          insert into "Users" ("Username", "FirstName", "LastName", "BookingEmployeeRef", "RoleId", "PasswordHash", "Status")
          values (${u.username}, ${u.firstName}, ${u.lastName}, ${u.bookingEmployeeRef ?? null}, ${roleId.get(u.role)}, ${u.passwordHash}, 1)`;
      }
    }

    for (const d of SEED_DEPOTS) {
      const [existing] = await tx`
        select "Id" from "Depots" where "Code" = ${d.code} and "IsDeleted" = false`;
      if (existing) {
        await tx`
          update "Depots" set
            "Name" = ${d.name}, "Lat" = ${d.lat}, "Lng" = ${d.lng}, "RadiusM" = ${d.radiusM},
            "IsActive" = true, "UpdatedAt" = now()
          where "Id" = ${existing.Id}`;
      } else {
        await tx`
          insert into "Depots" ("Code", "Name", "Lat", "Lng", "RadiusM")
          values (${d.code}, ${d.name}, ${d.lat}, ${d.lng}, ${d.radiusM})`;
      }
    }
  });

  return { users: users.length, depots: SEED_DEPOTS.length };
}

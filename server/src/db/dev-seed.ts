import type { Sql } from 'postgres';
import { hashPassword } from '../common/auth/password';
import type { RoleCode } from '../common/auth/permission-catalog';
import { normalizeUsername } from '../common/auth/username';

// Dev-only demo data for this system (no data from the old system — DL19).
// Roles / permissions / settings are NOT seeded here: they ship in drizzle/0003_reference_data.sql.

type Env = Record<string, string | undefined>;

export type SeedUser = { username: string; fullName: string; role: RoleCode };
export type SeedEmployee = {
  employeeCode: string;
  firstName: string;
  lastName: string;
  /** links the employee to this seed user */
  username: string | null;
  bookingEmployeeRef: string | null;
};

export const SEED_USERS: readonly SeedUser[] = [
  { username: 'admin', fullName: 'ผู้ดูแลระบบ', role: 'ADMIN' },
  { username: 'companyadmin1', fullName: 'ผู้ดูแลบริษัท ทดสอบ', role: 'COMPANY_ADMIN' },
  { username: 'operator1', fullName: 'สมชาย ใจดี', role: 'OPERATOR' },
  { username: 'viewer1', fullName: 'ผู้ดูข้อมูล ทดสอบ', role: 'VIEWER' },
];

export const SEED_EMPLOYEES: readonly SeedEmployee[] = [
  { employeeCode: 'E0001', firstName: 'สมชาย', lastName: 'ใจดี', username: 'operator1', bookingEmployeeRef: null },
  // BookingEmployeeRef is used by the booking-simulator (P3a) as the job's leaderRef.
  { employeeCode: 'E0002', firstName: 'สมหญิง', lastName: 'รักงาน', username: null, bookingEmployeeRef: 'BK-EMP-0002' },
];

export const DEFAULT_ADMIN_PASSWORD = 'Admin@12345';
export const DEFAULT_DEMO_PASSWORD = 'Demo@12345';

export function assertSeedAllowed(env: Env): void {
  if ((env.NODE_ENV ?? '').trim() === 'production') {
    throw new Error('db:seed ใช้เฉพาะเครื่อง dev — ปฏิเสธเมื่อ NODE_ENV=production');
  }
}

export function seedPassword(role: RoleCode, env: Env): string {
  const value = role === 'ADMIN' ? env.SEED_ADMIN_PASSWORD : env.SEED_DEMO_PASSWORD;
  if (value && value.trim()) return value;
  return role === 'ADMIN' ? DEFAULT_ADMIN_PASSWORD : DEFAULT_DEMO_PASSWORD;
}

/**
 * Upserts the demo users and employees in one transaction. Re-running resets the demo
 * accounts (role, password, active, unlocked) so the seed doubles as "reset dev logins".
 */
export async function runDevSeed(sql: Sql, env: Env): Promise<{ users: number; employees: number }> {
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
      throw new Error(`ไม่พบ role ${missing.join(', ')} — รัน npm run db:migrate ก่อน db:seed`);
    }

    const userId = new Map<string, string>();
    for (const u of users) {
      const [existing] = await tx`
        select "Id" from "Users" where lower("Username") = ${u.username} and "IsDeleted" = false`;
      const [row] = existing
        ? await tx`
            update "Users" set
              "FullName" = ${u.fullName}, "RoleId" = ${roleId.get(u.role)}, "PasswordHash" = ${u.passwordHash},
              "Status" = 1, "FailedLoginCount" = 0, "LockedUntil" = null, "UpdatedAt" = now()
            where "Id" = ${existing.Id} returning "Id"`
        : await tx`
            insert into "Users" ("Username", "FullName", "RoleId", "PasswordHash", "Status")
            values (${u.username}, ${u.fullName}, ${roleId.get(u.role)}, ${u.passwordHash}, 1)
            returning "Id"`;
      userId.set(u.username, String(row.Id));
    }

    for (const e of SEED_EMPLOYEES) {
      const linkedUserId = e.username ? userId.get(normalizeUsername(e.username)) : null;
      const [existing] = await tx`
        select "Id" from "Employees" where "EmployeeCode" = ${e.employeeCode} and "IsDeleted" = false`;
      if (existing) {
        await tx`
          update "Employees" set
            "FirstName" = ${e.firstName}, "LastName" = ${e.lastName}, "UserId" = ${linkedUserId ?? null},
            "BookingEmployeeRef" = ${e.bookingEmployeeRef}, "Status" = 1, "UpdatedAt" = now()
          where "Id" = ${existing.Id}`;
      } else {
        await tx`
          insert into "Employees" ("EmployeeCode", "FirstName", "LastName", "UserId", "BookingEmployeeRef", "Status")
          values (${e.employeeCode}, ${e.firstName}, ${e.lastName}, ${linkedUserId ?? null}, ${e.bookingEmployeeRef}, 1)`;
      }
    }
  });

  return { users: users.length, employees: SEED_EMPLOYEES.length };
}

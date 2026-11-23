import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../common/auth/password';
import { runDevSeed, SEED_DEPOTS, SEED_EMPLOYEES, SEED_USERS } from './dev-seed';

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, onnotice: () => {} });

const usernames = SEED_USERS.map((u) => u.username);
const employeeCodes = SEED_EMPLOYEES.map((e) => e.employeeCode);

const depotCodes = SEED_DEPOTS.map((d) => d.code);

const cleanup = async () => {
  await sql`delete from "Depots" where "Code" in ${sql(depotCodes)}`;
  await sql`delete from "Employees" where "EmployeeCode" in ${sql(employeeCodes)}`;
  await sql`delete from "Users" where lower("Username") in ${sql(usernames)}`;
};

const seededUsers = () => sql`
  select u."Username", u."PasswordHash", u."Status", r."Code" as "RoleCode"
  from "Users" u join "Roles" r on r."Id" = u."RoleId"
  where lower(u."Username") in ${sql(usernames)} and u."IsDeleted" = false
  order by u."Username"`;

describe('dev seed', () => {
  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    await sql.end();
  });

  it('creates the 4 demo users (one per P0 role) and 2 employees', async () => {
    const result = await runDevSeed(sql, { SEED_ADMIN_PASSWORD: 'Adm-1st', SEED_DEMO_PASSWORD: 'Demo-1st' });
    expect(result).toEqual({ users: 4, employees: 2, depots: 2 });

    const users = await seededUsers();
    expect(users.map((u) => [u.Username, u.RoleCode])).toEqual([
      ['admin', 'ADMIN'],
      ['companyadmin1', 'COMPANY_ADMIN'],
      ['operator1', 'OPERATOR'],
      ['viewer1', 'VIEWER'],
    ]);
    for (const u of users) expect(u.Status).toBe(1);
    const admin = users.find((u) => u.Username === 'admin');
    const viewer = users.find((u) => u.Username === 'viewer1');
    expect(await verifyPassword(admin?.PasswordHash, 'Adm-1st')).toBe(true);
    expect(await verifyPassword(viewer?.PasswordHash, 'Demo-1st')).toBe(true);

    const employees = await sql`
      select e."EmployeeCode", e."FirstName", e."LastName", e."BookingEmployeeRef", u."Username"
      from "Employees" e left join "Users" u on u."Id" = e."UserId"
      where e."EmployeeCode" in ${sql(employeeCodes)} order by e."EmployeeCode"`;
    expect(employees.map((e) => ({ ...e }))).toEqual([
      { EmployeeCode: 'E0001', FirstName: 'สมชาย', LastName: 'ใจดี', BookingEmployeeRef: null, Username: 'operator1' },
      { EmployeeCode: 'E0002', FirstName: 'สมหญิง', LastName: 'รักงาน', BookingEmployeeRef: 'BK-EMP-0002', Username: null },
    ]);
  });

  it('creates 2 mock depots (DEPOT-01 / DEPOT-02, radius 150 m) and keeps them on a re-run', async () => {
    await runDevSeed(sql, {});
    await sql`update "Depots" set "RadiusM" = 500 where "Code" = 'DEPOT-01'`;
    await runDevSeed(sql, {});
    const depots = await sql`
      select "Code", "Lat", "Lng", "RadiusM", "IsActive" from "Depots"
      where "Code" in ${sql(depotCodes)} and "IsDeleted" = false order by "Code"`;
    expect(depots.map((d) => ({ ...d }))).toEqual([
      { Code: 'DEPOT-01', Lat: 13.7563, Lng: 100.5018, RadiusM: 150, IsActive: true },
      { Code: 'DEPOT-02', Lat: 13.8, Lng: 100.55, RadiusM: 150, IsActive: true },
    ]);
  });

  it('is idempotent and resets demo passwords on a re-run', async () => {
    await sql`update "Users" set "FailedLoginCount" = 3, "LockedUntil" = now() + interval '1 hour'
              where "Username" = 'operator1'`;

    await runDevSeed(sql, { SEED_DEMO_PASSWORD: 'Demo-2nd' });

    const users = await seededUsers();
    expect(users).toHaveLength(4);
    const [{ n }] = await sql`select count(*)::int as n from "Employees" where "EmployeeCode" in ${sql(employeeCodes)}`;
    expect(n).toBe(2);

    const operator = users.find((u) => u.Username === 'operator1');
    expect(await verifyPassword(operator?.PasswordHash, 'Demo-2nd')).toBe(true);
    const [lock] = await sql`select "FailedLoginCount", "LockedUntil" from "Users" where "Username" = 'operator1'`;
    expect(lock.FailedLoginCount).toBe(0);
    expect(lock.LockedUntil).toBeNull();
  });
});

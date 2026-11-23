import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// P1 tables and their DB-level invariants (Part 4 §4.4 B, C, D, H).

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, onnotice: () => {} });

function yyyymm(offsetMonths: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const cleanup = async () => {
  await sql`delete from "GpsLocations" where "DeviceId" < 0`;
  await sql`delete from "Alerts" where "DedupeKey" like 'p1t:%'`;
  await sql`delete from "TeamMembers" where "TeamId" in (select "Id" from "Teams" where "Code" like 'P1T_%')`;
  await sql`delete from "Teams" where "Code" like 'P1T_%'`;
  await sql`delete from "Employees" where "EmployeeCode" like 'P1T_%'`;
  await sql`delete from "DeviceStatusHistory" where "DeviceId" in (select "Id" from "Devices" where "VendorDeviceId" like 'P1T-%')`;
  await sql`delete from "DeviceState" where "DeviceId" in (select "Id" from "Devices" where "VendorDeviceId" like 'P1T-%')`;
  await sql`delete from "Devices" where "VendorDeviceId" like 'P1T-%'`;
  await sql`delete from "Depots" where "Code" like 'P1T_%'`;
};

const insertDevice = async (code: string, vendorId: string) => {
  const [row] = await sql`
    insert into "Devices" ("DeviceCode", "VendorDeviceId", "Kind") values (${code}, ${vendorId}, 1)
    returning "Id", "Status", "StreamingEnabled"`;
  return row;
};

const insertEmployee = async (code: string) => {
  const [row] = await sql`
    insert into "Employees" ("EmployeeCode", "FirstName", "LastName") values (${code}, 'ทดสอบ', 'P1')
    returning "Id"`;
  return String(row.Id);
};

describe('P1 schema', () => {
  beforeAll(cleanup);
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await sql.end();
  });

  describe('Devices', () => {
    it('defaults Status 1 and StreamingEnabled true', async () => {
      const row = await insertDevice('P1T_D1', 'P1T-1');
      expect(row.Status).toBe(1);
      expect(row.StreamingEnabled).toBe(true);
    });

    it('VendorDeviceId stays unique even after the old row is soft-deleted', async () => {
      await insertDevice('P1T_D1', 'P1T-1');
      await sql`update "Devices" set "IsDeleted" = true, "DeletedAt" = now() where "VendorDeviceId" = 'P1T-1'`;
      await expect(insertDevice('P1T_D2', 'P1T-1')).rejects.toMatchObject({
        constraint_name: 'UQ_Devices_VendorId',
      });
    });

    it('DeviceCode is unique among live rows only', async () => {
      await insertDevice('P1T_D1', 'P1T-1');
      await expect(insertDevice('P1T_D1', 'P1T-2')).rejects.toMatchObject({
        constraint_name: 'UQ_Devices_Code',
      });
      await sql`update "Devices" set "IsDeleted" = true, "DeletedAt" = now() where "VendorDeviceId" = 'P1T-1'`;
      await expect(insertDevice('P1T_D1', 'P1T-2')).resolves.toBeDefined();
    });

    it('DeviceState is a 1:1 row keyed by DeviceId with nullable state', async () => {
      const device = await insertDevice('P1T_D1', 'P1T-1');
      await sql`insert into "DeviceState" ("DeviceId") values (${device.Id})`;
      const [state] = await sql`select * from "DeviceState" where "DeviceId" = ${device.Id}`;
      expect(state.PlatformState).toBeNull();
      expect(state.LastObservedAt).toBeNull();
      expect(state.UpdatedAt).toBeInstanceOf(Date);
      await expect(sql`insert into "DeviceState" ("DeviceId") values (${device.Id})`).rejects.toMatchObject({
        code: '23505',
      });
    });

    it('DeviceStatusHistory needs ToState, ObservedAt and Source', async () => {
      const device = await insertDevice('P1T_D1', 'P1T-1');
      await sql`
        insert into "DeviceStatusHistory" ("DeviceId", "FromState", "ToState", "ObservedAt", "Source")
        values (${device.Id}, null, 1, now(), 2)`;
      await expect(
        sql`insert into "DeviceStatusHistory" ("DeviceId", "ToState", "Source") values (${device.Id}, 1, 2)`,
      ).rejects.toMatchObject({ code: '23502' });
    });
  });

  describe('Teams / TeamMembers', () => {
    const insertTeam = async (code: string, bookingRef: string | null = null) => {
      const [row] = await sql`
        insert into "Teams" ("Code", "Name", "BookingTeamRef") values (${code}, ${code}, ${bookingRef})
        returning "Id"`;
      return String(row.Id);
    };

    it('Code and BookingTeamRef are unique among live rows', async () => {
      await insertTeam('P1T_T1', 'P1T-REF-1');
      await expect(insertTeam('P1T_T1')).rejects.toMatchObject({ constraint_name: 'UQ_Teams_Code' });
      await expect(insertTeam('P1T_T2', 'P1T-REF-1')).rejects.toMatchObject({
        constraint_name: 'UQ_Teams_BookingRef',
      });
      await expect(insertTeam('P1T_T3')).resolves.toBeDefined();
      await expect(insertTeam('P1T_T4')).resolves.toBeDefined();
    });

    it('rejects a window that ends before it starts', async () => {
      const team = await insertTeam('P1T_T1');
      const emp = await insertEmployee('P1T_E1');
      await expect(sql`
        insert into "TeamMembers" ("TeamId", "EmployeeId", "Role", "ValidFrom", "ValidTo")
        values (${team}, ${emp}, 1, now(), now() - interval '1 hour')`).rejects.toMatchObject({
        constraint_name: 'CK_TeamMembers_Window',
      });
    });

    it('two leaders of one team cannot overlap in time, even when both windows are closed', async () => {
      const team = await insertTeam('P1T_T1');
      const a = await insertEmployee('P1T_E1');
      const b = await insertEmployee('P1T_E2');
      await sql`
        insert into "TeamMembers" ("TeamId", "EmployeeId", "Role", "ValidFrom", "ValidTo")
        values (${team}, ${a}, 1, '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z')`;
      await expect(sql`
        insert into "TeamMembers" ("TeamId", "EmployeeId", "Role", "ValidFrom", "ValidTo")
        values (${team}, ${b}, 1, '2026-01-02T00:00:00Z', '2026-01-04T00:00:00Z')`).rejects.toMatchObject({
        constraint_name: 'EX_TeamMembers_LeaderNoOverlap',
      });
      // back-to-back windows are fine ('[)' range)
      await expect(sql`
        insert into "TeamMembers" ("TeamId", "EmployeeId", "Role", "ValidFrom", "ValidTo")
        values (${team}, ${b}, 1, '2026-01-03T00:00:00Z', '2026-01-04T00:00:00Z')`).resolves.toBeDefined();
    });

    it('one active leader per team and one active team per employee', async () => {
      const t1 = await insertTeam('P1T_T1');
      const t2 = await insertTeam('P1T_T2');
      const a = await insertEmployee('P1T_E1');
      const b = await insertEmployee('P1T_E2');
      await sql`
        insert into "TeamMembers" ("TeamId", "EmployeeId", "Role", "ValidFrom") values (${t1}, ${a}, 2, now())`;
      await expect(sql`
        insert into "TeamMembers" ("TeamId", "EmployeeId", "Role", "ValidFrom") values (${t2}, ${a}, 2, now())`,
      ).rejects.toMatchObject({ constraint_name: 'UQ_TeamMembers_ActiveEmployee' });
      await sql`
        insert into "TeamMembers" ("TeamId", "EmployeeId", "Role", "ValidFrom")
        values (${t2}, ${b}, 1, '2026-01-01T00:00:00Z')`;
      const c = await insertEmployee('P1T_E3');
      await expect(sql`
        insert into "TeamMembers" ("TeamId", "EmployeeId", "Role", "ValidFrom")
        values (${t2}, ${c}, 1, '2027-01-01T00:00:00Z')`).rejects.toMatchObject({
        // both guard this case; which one fires first is up to PostgreSQL
        constraint_name: expect.stringMatching(/^(UQ_TeamMembers_ActiveLeader|EX_TeamMembers_LeaderNoOverlap)$/),
      });
    });
  });

  describe('Depots', () => {
    it('defaults RadiusM to 150 and keeps it within 20–2000', async () => {
      const [row] = await sql`
        insert into "Depots" ("Code", "Name", "Lat", "Lng") values ('P1T_DP1', 'ฐาน', 13.75, 100.5)
        returning "RadiusM", "IsActive"`;
      expect(row.RadiusM).toBe(150);
      expect(row.IsActive).toBe(true);
      await expect(sql`
        insert into "Depots" ("Code", "Name", "Lat", "Lng", "RadiusM") values ('P1T_DP2', 'ฐาน', 13.75, 100.5, 10)`,
      ).rejects.toMatchObject({ constraint_name: 'CK_Depots_Radius' });
      await expect(sql`
        insert into "Depots" ("Code", "Name", "Lat", "Lng") values ('P1T_DP1', 'ซ้ำ', 13.75, 100.5)`,
      ).rejects.toMatchObject({ constraint_name: 'UQ_Depots_Code' });
    });
  });

  describe('Alerts', () => {
    const raise = (status: number) => sql`
      insert into "Alerts" ("AlertType", "Severity", "Status", "Title", "DedupeKey")
      values (13, 2, ${status}, 'ทดสอบ', 'p1t:dup') returning "Id", "OccurredAt"`;

    it('one open alert per DedupeKey; a resolved one does not block a new one', async () => {
      const [first] = await raise(1);
      expect(first.OccurredAt).toBeInstanceOf(Date);
      await expect(raise(1)).rejects.toMatchObject({ constraint_name: 'UQ_Alerts_OpenDedupe' });
      await expect(raise(2)).rejects.toMatchObject({ constraint_name: 'UQ_Alerts_OpenDedupe' });
      await sql`update "Alerts" set "Status" = 3, "ResolvedAt" = now() where "Id" = ${first.Id}`;
      await expect(raise(1)).resolves.toHaveLength(1);
    });
  });

  describe('GpsLocations', () => {
    it('is partitioned by month with default, current, +1 and +2 month partitions', async () => {
      const parts = await sql`
        select c.relname from pg_inherits i
        join pg_class c on c.oid = i.inhrelid
        join pg_class p on p.oid = i.inhparent
        where p.relname = 'GpsLocations'`;
      expect(parts.map((p) => p.relname)).toEqual(
        expect.arrayContaining([
          'GpsLocations_default',
          `GpsLocations_${yyyymm(0)}`,
          `GpsLocations_${yyyymm(1)}`,
          `GpsLocations_${yyyymm(2)}`,
        ]),
      );
      const [kind] = await sql`select relkind from pg_class where relname = 'GpsLocations'`;
      expect(kind.relkind).toBe('p');
    });

    it('defaults IsValidFix to true, and a repeated point is a no-op with ON CONFLICT DO NOTHING', async () => {
      const at = new Date();
      const insert = () => sql`
        insert into "GpsLocations" ("DeviceId", "RecordedAt", "Lat", "Lng")
        values (-1, ${at}, 13.75, 100.5)
        on conflict ("DeviceId", "RecordedAt") do nothing returning "DeviceId"`;
      expect(await insert()).toHaveLength(1);
      expect(await insert()).toHaveLength(0);
      const [row] = await sql`select "IsValidFix", "ReceivedAt" from "GpsLocations" where "DeviceId" = -1`;
      expect(row.IsValidFix).toBe(true);
      expect(row.ReceivedAt).toBeInstanceOf(Date);
    });

    it('has a BRIN index on RecordedAt', async () => {
      const rows = await sql`
        select am.amname from pg_class c join pg_am am on am.oid = c.relam
        where c.relname = 'IX_GpsLocations_RecordedAt_brin'`;
      expect(rows.map((r) => r.amname)).toEqual(['brin']);
    });
  });
});

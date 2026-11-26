import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../common/auth/password';
import { bootHttpContext, createTestUsers, dropTestUsers, type HttpContext } from '../../test/int-helpers';

const PREFIX = 't_exportschema_';
const CODE = 'CAM-IT-EXPORT-A';

let ctx: HttpContext;
let userId: bigint;
let deviceId: bigint;

beforeAll(async () => {
  ctx = await bootHttpContext();
  const ids = await createTestUsers(ctx.sql, [{ username: `${PREFIX}u`, role: 'OPERATOR' }], await hashPassword('Test@12345'));
  userId = ids.get(`${PREFIX}u`) as bigint;
  await ctx.sql`delete from "EvidenceExports" where "DeviceId" in (select "Id" from "Devices" where "DeviceCode" = ${CODE})`;
  await ctx.sql`delete from "Devices" where "DeviceCode" = ${CODE}`;
  const [d] = await ctx.sql`insert into "Devices" ("DeviceCode","VendorDeviceId","Kind","Status")
    values (${CODE}, ${`VENDOR-${CODE}`}, 1, 1) returning "Id"`;
  deviceId = d.Id as bigint;
});

afterAll(async () => {
  if (!ctx) return;
  await ctx.sql`delete from "EvidenceExports" where "DeviceId" = ${deviceId}`;
  await ctx.sql`delete from "Devices" where "Id" = ${deviceId}`;
  await dropTestUsers(ctx.sql, [`${PREFIX}%`]);
  await ctx.close();
});

describe('EvidenceExports schema', () => {
  it('defaults Status 1, Progress 0, Channel 1', async () => {
    const [row] = await ctx.sql`insert into "EvidenceExports" ("DeviceId","StartAt","EndAt","RequestedBy")
      values (${deviceId}, now() - interval '1 hour', now(), ${userId}) returning *`;
    expect(row.Status).toBe(1);
    expect(row.Progress).toBe(0);
    expect(row.Channel).toBe(1);
    expect(row.WorkOrderId).toBeNull();
  });

  it('rejects a missing device (FK)', async () => {
    await expect(
      ctx.sql`insert into "EvidenceExports" ("DeviceId","StartAt","EndAt","RequestedBy")
        values (999999999, now() - interval '1 hour', now(), ${userId})`,
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('has the three indexes', async () => {
    const rows = await ctx.sql`select indexname from pg_indexes where tablename = 'EvidenceExports'`;
    const names = rows.map((r) => r.indexname);
    expect(names).toEqual(expect.arrayContaining(['IX_EvidenceExport_Range', 'IX_EvidenceExport_Status', 'IX_EvidenceExport_User']));
  });
});

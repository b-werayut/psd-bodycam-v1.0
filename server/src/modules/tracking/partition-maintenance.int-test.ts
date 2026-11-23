import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisLockService } from '../../common/lock/redis-lock.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { monthlyPartitionsAhead } from '../../db/partitions';
import { bootHttpContext, resetDevices, type HttpContext } from '../../test/int-helpers';
import { PartitionMaintenanceJob } from './partition-maintenance.job';

let ctx: HttpContext;

const months = (offset: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 15));
};
const suffixAt = (offset: number) => monthlyPartitionsAhead(months(offset), 0)[0].suffix;
const exists = async (name: string) =>
  (await ctx.sql`select 1 from pg_class where relname = ${name} and relkind = 'r'`).length === 1;
const job = () => new PartitionMaintenanceJob(ctx.app.get<DrizzleDB>(DRIZZLE), ctx.app.get(RedisLockService));

beforeAll(async () => {
  ctx = await bootHttpContext();
  await resetDevices(ctx.sql);
});

afterAll(async () => {
  await resetDevices(ctx.sql);
  // partitions this test made beyond what the migrations create
  await ctx.sql.unsafe(`DROP TABLE IF EXISTS "AuditLogs_${suffixAt(3)}"`);
  await ctx.sql.unsafe(`DROP TABLE IF EXISTS "GpsLocations_${suffixAt(3)}"`);
  await ctx.close();
});

describe('PartitionMaintenanceJob.runOnce', () => {
  it('re-creates a missing month-ahead partition of GpsLocations; a second run creates nothing', async () => {
    const plus2 = `GpsLocations_${suffixAt(2)}`;
    await ctx.sql.unsafe(`DROP TABLE IF EXISTS "${plus2}"`);
    expect(await exists(plus2)).toBe(false);

    const first = await job().runOnce();
    expect(first?.created).toContain(plus2);
    expect(first?.blocked).toEqual([]);
    expect(await exists(plus2)).toBe(true);

    expect((await job().runOnce())?.created).toEqual([]);
  });

  it('a default partition holding rows of that month blocks it (logged, not created)', async () => {
    const plus3 = suffixAt(3);
    await ctx.sql`insert into "GpsLocations" ("DeviceId", "RecordedAt", "Lat", "Lng") values (-77, ${months(3)}, 13.7, 100.5)`;
    try {
      const result = await job().runOnce(months(1));
      expect(result?.blocked).toContain(`GpsLocations_${plus3}`);
      expect(result?.created).not.toContain(`GpsLocations_${plus3}`);
      expect(result?.created).toContain(`AuditLogs_${plus3}`);
      expect(await exists(`GpsLocations_${plus3}`)).toBe(false);
    } finally {
      await ctx.sql`delete from "GpsLocations" where "DeviceId" = -77`;
    }
  });

  it('without Redis it does nothing', async () => {
    const noLock = new PartitionMaintenanceJob(ctx.app.get<DrizzleDB>(DRIZZLE), new RedisLockService(null));
    expect(await noLock.runOnce()).toBeNull();
  });
});

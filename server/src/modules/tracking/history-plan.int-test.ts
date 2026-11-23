import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { monthlyPartitionsAhead } from '../../db/partitions';

// The route history query (TrackingReadService.deviceHistory) must read one camera's range through the
// primary key of only the partition(s) of that range. Same SQL shape as the service, literal values so the
// planner prunes at plan time. The < 2 s at 10M rows target is measured by hand (plan Task 14).

const sql = postgres(process.env.DATABASE_URL as string, { max: 1, onnotice: () => {} });

afterAll(async () => {
  await sql.end();
});

type PlanNode = { 'Node Type': string; 'Relation Name'?: string; 'Index Name'?: string; Plans?: PlanNode[] };

const walk = (node: PlanNode, out: PlanNode[] = []): PlanNode[] => {
  out.push(node);
  for (const child of node.Plans ?? []) walk(child, out);
  return out;
};

describe('history query plan', () => {
  it('uses PK_GpsLocations on the month partition only', async () => {
    const month = monthlyPartitionsAhead(new Date(), 0)[0];
    const from = new Date(Date.parse(month.from) + 3_600_000).toISOString();
    const to = new Date(Date.parse(month.from) + 25 * 3_600_000).toISOString();

    const nodes = await sql.begin(async (tx) => {
      await tx`set local enable_seqscan = off`;
      const [row] = await tx.unsafe(
        `explain (format json)
         select "RecordedAt", "Lat", "Lng", "IsValidFix" from "GpsLocations"
         where "DeviceId" = 1 and "RecordedAt" >= '${from}' and "RecordedAt" <= '${to}'
         order by "RecordedAt" asc limit 50001`,
      );
      return walk((row['QUERY PLAN'] as { Plan: PlanNode }[])[0].Plan);
    });

    const relations = nodes.map((n) => n['Relation Name']).filter(Boolean);
    expect(relations).toEqual([`GpsLocations_${month.suffix}`]);
    const scan = nodes.find((n) => n['Relation Name'] === `GpsLocations_${month.suffix}`)!;
    expect(scan['Node Type']).toMatch(/Index/);
    expect(scan['Index Name']).toMatch(/pkey|PK_GpsLocations/);
  });
});

import { describe, expect, it } from 'vitest';
import { monthlyPartitionsAhead, partitionName } from './partitions';

describe('monthlyPartitionsAhead', () => {
  it('current month + N months, UTC boundaries, across a year end', () => {
    expect(monthlyPartitionsAhead(new Date('2026-12-15T10:00:00Z'), 2)).toEqual([
      { suffix: '202612', from: '2026-12-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' },
      { suffix: '202701', from: '2027-01-01T00:00:00.000Z', to: '2027-02-01T00:00:00.000Z' },
      { suffix: '202702', from: '2027-02-01T00:00:00.000Z', to: '2027-03-01T00:00:00.000Z' },
    ]);
  });

  it('uses the UTC month even when Bangkok is already in the next month', () => {
    // 2026-11-30T20:00Z = 2026-12-01 03:00 in Asia/Bangkok
    expect(monthlyPartitionsAhead(new Date('2026-11-30T20:00:00Z'), 0)[0].suffix).toBe('202611');
  });

  it('names partitions <table>_YYYYMM', () => {
    expect(partitionName('GpsLocations', '202612')).toBe('GpsLocations_202612');
  });
});

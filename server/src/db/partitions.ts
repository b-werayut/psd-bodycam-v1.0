/** One monthly range partition (UTC month boundaries, Part 4 §4.9). */
export type MonthlyPartition = { suffix: string; from: string; to: string };

/** The current UTC month and `monthsAhead` months after it. */
export function monthlyPartitionsAhead(now: Date, monthsAhead: number): MonthlyPartition[] {
  const out: MonthlyPartition[] = [];
  for (let i = 0; i <= monthsAhead; i++) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const suffix = `${from.getUTCFullYear()}${String(from.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ suffix, from: from.toISOString(), to: to.toISOString() });
  }
  return out;
}

export const partitionName = (table: string, suffix: string) => `${table}_${suffix}`;

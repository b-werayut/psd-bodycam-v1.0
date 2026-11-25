import { describe, expect, it } from 'vitest';
import { externalEventIdOf } from '../inbound/inbound-body';
import { validateInboundBody } from '../inbound/inbound-body';
import { buildScenario, SIM_DEFAULTS, type SimOptions } from './scenarios';

const NOW = new Date('2026-11-25T05:00:00Z'); // 12:00 in Asia/Bangkok
const opts: SimOptions = { ...SIM_DEFAULTS };

describe('buildScenario', () => {
  it('demo builds 3 jobs: Planned today, Open checked in an hour ago, Closed yesterday, all on camera 1000027 with leader BK-EMP-0002', () => {
    const items = buildScenario('demo', opts, NOW);
    expect(items).toHaveLength(3);
    const [planned, open, closed] = items.map((i) => i.envelope.job);
    expect(new Set(items.map((i) => i.envelope.job.jobId)).size).toBe(3);
    for (const job of [planned!, open!, closed!]) {
      expect(job.deviceRefs).toEqual(['1000027']);
      expect(job.leaderRef).toBe('BK-EMP-0002');
      expect(job.teamRef).toBe('TEAM-DEMO');
      expect(job.title).toBeTruthy();
      expect((job.site as { name?: string }).name).toBeTruthy();
    }
    expect(planned!.status).toBe('SCHEDULED');
    expect(planned!.checkInAt ?? null).toBeNull();
    expect(planned!.scheduledDate).toBe('2026-11-25');
    expect(Date.parse(planned!.plannedStartAt as string)).toBeGreaterThan(NOW.getTime());
    expect((planned!.plannedStartAt as string).startsWith('2026-11-25')).toBe(true);

    expect(open!.status).toBe('IN_PROGRESS');
    expect(Date.parse(open!.checkInAt as string)).toBe(NOW.getTime() - 3600_000);
    expect(open!.checkOutAt ?? null).toBeNull();

    expect(closed!.status).toBe('COMPLETED');
    expect((closed!.checkInAt as string).startsWith('2026-11-24')).toBe(true);
    expect((closed!.checkOutAt as string).startsWith('2026-11-24')).toBe(true);
    expect(Date.parse(closed!.checkOutAt as string)).toBeGreaterThan(Date.parse(closed!.checkInAt as string));
  });

  it('every envelope passes the server body validation', () => {
    for (const name of ['new', 'duplicate', 'out-of-order', 'bad-signature', 'burst', 'demo'] as const) {
      for (const { envelope } of buildScenario(name, { ...opts, count: 5 }, NOW)) {
        expect(validateInboundBody(JSON.parse(JSON.stringify(envelope))).ok).toBe(true);
      }
    }
  });

  it('out-of-order sends version 3 before version 2 of one job', () => {
    const items = buildScenario('out-of-order', opts, NOW);
    expect(items.map((i) => i.envelope.job.version)).toEqual([3, 2]);
    expect(new Set(items.map((i) => i.envelope.job.jobId)).size).toBe(1);
    // the same updatedAt on both: the server's version guard falls back to the version and ignores version 2
    expect(new Set(items.map((i) => i.envelope.job.updatedAt)).size).toBe(1);
  });

  it('duplicate sends the same eventId twice', () => {
    const items = buildScenario('duplicate', opts, NOW);
    expect(items).toHaveLength(2);
    expect(externalEventIdOf(items[0]!.envelope)).toBe(externalEventIdOf(items[1]!.envelope));
  });

  it('checkin without --job throws a message asking for --job', () => {
    expect(() => buildScenario('checkin', opts, NOW)).toThrow(/--job/);
    expect(() => buildScenario('checkout', opts, NOW)).toThrow(/--job/);
    expect(() => buildScenario('cancel', opts, NOW)).toThrow(/--job/);
  });

  it('checkin / checkout / cancel on an existing job use a version from the unix clock', () => {
    const withJob = { ...opts, jobId: 'BK-J1' };
    const secs = Math.floor(NOW.getTime() / 1000);
    const [checkin] = buildScenario('checkin', withJob, NOW);
    expect(checkin!.envelope.job).toMatchObject({ jobId: 'BK-J1', status: 'IN_PROGRESS', version: secs });
    const [checkout] = buildScenario('checkout', withJob, NOW);
    expect(checkout!.envelope.job).toMatchObject({ status: 'COMPLETED', version: secs });
    expect(checkout!.envelope.job.checkOutAt).toBeTruthy();
    const [cancel] = buildScenario('cancel', withJob, NOW);
    expect(cancel!.envelope.job).toMatchObject({ status: 'CANCELLED', version: secs });
  });

  it('bad-signature marks the request for a corrupted signature', () => {
    const items = buildScenario('bad-signature', opts, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]!.corruptSignature).toBe(true);
  });

  it('burst builds --count distinct jobs', () => {
    const items = buildScenario('burst', { ...opts, count: 37 }, NOW);
    expect(items).toHaveLength(37);
    expect(new Set(items.map((i) => i.envelope.job.jobId)).size).toBe(37);
  });
});

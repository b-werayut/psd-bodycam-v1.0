import { describe, expect, it } from 'vitest';
import { externalEventIdOf, validateInboundBody } from './inbound-body';

const ok = (job: Record<string, unknown>, top: Record<string, unknown> = {}) =>
  validateInboundBody({ ...top, job: { jobId: 'J1', status: 'NEW', version: 1, ...job } });
const fields = (r: ReturnType<typeof validateInboundBody>) => (r.ok ? [] : r.details.map((d) => d.field));

describe('validateInboundBody', () => {
  it('accepts a minimal body', () => {
    expect(ok({}).ok).toBe(true);
  });

  it('jobId, status and version or updatedAt are required', () => {
    const r = validateInboundBody({ job: {} });
    expect(r.ok).toBe(false);
    const f = fields(r);
    expect(f).toContain('job.jobId');
    expect(f).toContain('job.status');
    expect(f).toContain('job.version');
    if (!r.ok) expect(r.details.every((d) => typeof d.issue === 'string')).toBe(true);
  });

  it('updatedAt alone satisfies the version rule', () => {
    expect(validateInboundBody({ job: { jobId: 'J', status: 'NEW', updatedAt: '2026-11-25T10:00:00+07:00' } }).ok).toBe(true);
  });

  it('a non object body or missing job is rejected', () => {
    expect(fields(validateInboundBody(null))).toContain('body');
    expect(fields(validateInboundBody({}))).toContain('job');
  });

  it('unknown fields are kept', () => {
    const r = validateInboundBody({ foo: 'x', job: { jobId: 'J', status: 'NEW', version: 1, extra: 1 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.value.job as Record<string, unknown>).extra).toBe(1);
      expect((r.value as Record<string, unknown>).foo).toBe('x');
    }
  });

  it('null optional fields are treated as absent', () => {
    expect(ok({ checkInAt: null, checkOutAt: null, site: null, teamRef: null }).ok).toBe(true);
  });

  it('doNo longer than 50 is rejected; title longer than 300 is cut to 300', () => {
    expect(fields(ok({ doNo: 'x'.repeat(51) }))).toContain('job.doNo');
    expect(ok({ doNo: 'x'.repeat(50) }).ok).toBe(true);
    const r = ok({ title: 'ก'.repeat(400), site: { name: 'n'.repeat(400), address: 'a'.repeat(1200) } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.job.title).toHaveLength(300);
      expect(r.value.job.site?.name).toHaveLength(300);
      expect(r.value.job.site?.address).toHaveLength(1000);
    }
  });

  it('a non string title is rejected', () => {
    expect(fields(ok({ title: 5 }))).toContain('job.title');
  });

  it('jobId and status length limits', () => {
    expect(fields(ok({ jobId: 'j'.repeat(101) }))).toContain('job.jobId');
    expect(fields(ok({ status: 's'.repeat(51) }))).toContain('job.status');
  });

  it('envelope eventId, eventType and occurredAt limits', () => {
    expect(fields(ok({}, { eventId: 'e'.repeat(201) }))).toContain('eventId');
    expect(fields(ok({}, { eventType: 't'.repeat(51) }))).toContain('eventType');
    expect(fields(ok({}, { occurredAt: '2026-11-25T10:00:00' }))).toContain('occurredAt');
  });

  it('deviceRefs must be strings of at most 64, 50 items at most', () => {
    expect(ok({ deviceRefs: ['A', 'B'] }).ok).toBe(true);
    expect(fields(ok({ deviceRefs: ['x'.repeat(65)] }))).toContain('job.deviceRefs[0]');
    expect(fields(ok({ deviceRefs: [1] }))).toContain('job.deviceRefs[0]');
    expect(fields(ok({ deviceRefs: Array.from({ length: 51 }, (_, i) => `D${i}`) }))).toContain('job.deviceRefs');
    expect(fields(ok({ deviceRefs: 'A' }))).toContain('job.deviceRefs');
  });

  it('teamRef and leaderRef up to 64', () => {
    expect(fields(ok({ teamRef: 't'.repeat(65) }))).toContain('job.teamRef');
    expect(fields(ok({ leaderRef: 'l'.repeat(65) }))).toContain('job.leaderRef');
  });

  it('a date without offset is rejected', () => {
    expect(fields(ok({ checkInAt: '2026-11-25T10:00:00' }))).toContain('job.checkInAt');
    expect(fields(ok({ updatedAt: 'yesterday' }))).toContain('job.updatedAt');
    expect(ok({ checkInAt: '2026-11-25T10:00:00+07:00', plannedStartAt: '2026-11-25T03:00:00Z' }).ok).toBe(true);
  });

  it('scheduledDate must be YYYY-MM-DD', () => {
    expect(ok({ scheduledDate: '2026-11-25' }).ok).toBe(true);
    expect(fields(ok({ scheduledDate: '2026-13-45' }))).toContain('job.scheduledDate');
    expect(fields(ok({ scheduledDate: '25/11/2026' }))).toContain('job.scheduledDate');
  });

  it('site.lat out of range is rejected', () => {
    expect(fields(ok({ site: { lat: 91 } }))).toContain('job.site.lat');
    expect(fields(ok({ site: { lng: -181 } }))).toContain('job.site.lng');
    expect(fields(ok({ site: { lat: '13.6' } }))).toContain('job.site.lat');
    expect(ok({ site: { lat: 13.66, lng: 100.63 } }).ok).toBe(true);
  });

  it('version must be a non negative integer', () => {
    expect(fields(ok({ version: -1 }))).toContain('job.version');
    expect(fields(ok({ version: 1.5 }))).toContain('job.version');
  });
});

describe('externalEventIdOf', () => {
  const env = (e: Record<string, unknown>) => {
    const r = validateInboundBody(e);
    if (!r.ok) throw new Error('invalid fixture');
    return r.value;
  };

  it('eventId wins; then jobId:version; then jobId:updatedAt normalised', () => {
    expect(externalEventIdOf(env({ eventId: 'E1', job: { jobId: 'J1', status: 'NEW', version: 3 } }))).toBe('E1');
    expect(externalEventIdOf(env({ job: { jobId: 'J1', status: 'NEW', version: 3, updatedAt: '2026-11-25T10:00:00+07:00' } }))).toBe('J1:3');
    expect(externalEventIdOf(env({ job: { jobId: 'J1', status: 'NEW', version: 0 } }))).toBe('J1:0');
    expect(externalEventIdOf(env({ job: { jobId: 'J1', status: 'NEW', updatedAt: '2026-11-25T10:00:00+07:00' } }))).toBe(
      'J1:2026-11-25T03:00:00.000Z',
    );
  });
});

import { describe, expect, it } from 'vitest';
import type { InboundEnvelopeV1 } from '../inbound/inbound-body';
import { canonicalStatus, mapV1 } from './mapper-v1';
import { payloadHash } from './payload-hash';

const env = (job: Partial<InboundEnvelopeV1['job']> = {}): InboundEnvelopeV1 => ({
  job: { jobId: 'J1', status: 'NEW', version: 3, ...job },
});

describe('mapper v1', () => {
  it('status map: IN_PROGRESS ⇒ 3, done ⇒ 4, REJECTED ⇒ 5, WEIRD ⇒ 9', () => {
    expect(canonicalStatus('IN_PROGRESS')).toBe(3);
    expect(canonicalStatus(' in_progress ')).toBe(3);
    expect(canonicalStatus('done')).toBe(4);
    expect(canonicalStatus('REJECTED')).toBe(5);
    expect(canonicalStatus('WEIRD')).toBe(9);
    expect(canonicalStatus('new')).toBe(1);
    expect(canonicalStatus('Assigned')).toBe(2);
  });

  it('deviceRefs are trimmed and de-duplicated', () => {
    expect(mapV1(env({ deviceRefs: [' 1000027 ', '1000027'] })).deviceRefs).toEqual(['1000027']);
  });

  it('treats empty teamRef / leaderRef / deviceRefs items as absent', () => {
    const s = mapV1(env({ teamRef: '  ', leaderRef: '', deviceRefs: ['', ' ', 'A'] }));
    expect(s.teamRef).toBeNull();
    expect(s.leaderRef).toBeNull();
    expect(s.deviceRefs).toEqual(['A']);
  });

  it('blank title ⇒ null so the title falls back', () => {
    expect(mapV1(env({ title: '   ' })).title).toBeNull();
    expect(mapV1(env({ title: '' })).title).toBeNull();
  });

  it('nested objects and arrays hash the same regardless of key order', () => {
    const a = { jobId: 'J1', site: { name: 'x', geo: { lat: 1, lng: 2 } }, items: [{ a: 1, b: 2 }, { c: 3 }] };
    const b = { items: [{ b: 2, a: 1 }, { c: 3 }], site: { geo: { lng: 2, lat: 1 }, name: 'x' }, jobId: 'J1' };
    expect(payloadHash(a)).toBe(payloadHash(b));
    expect(payloadHash({ ...a, items: [{ c: 3 }, { a: 1, b: 2 }] })).not.toBe(payloadHash(a));
  });

  it('the same job with keys in another order has the same payloadHash', () => {
    const a = { jobId: 'J1', status: 'NEW', site: { name: 'x', lat: 1 } };
    const b = { site: { lat: 1, name: 'x' }, status: 'NEW', jobId: 'J1' };
    expect(payloadHash(a)).toBe(payloadHash(b));
    expect(payloadHash(a)).not.toBe(payloadHash({ ...a, status: 'DONE' }));
  });

  it('maps fields, dates, version and site', () => {
    const s = mapV1(
      env({
        jobNo: 'N1', doNo: 'D1', shNo: 'S1', title: 'T', teamRef: ' T1 ', updatedAt: '2026-11-25T10:00:00+07:00',
        checkInAt: '2026-11-25T01:00:00Z', checkOutAt: null, scheduledDate: '2026-11-25',
        site: { name: 'Site', address: 'Addr', lat: 13.7, lng: 100.5 },
      }),
    );
    expect(s).toMatchObject({
      externalJobId: 'J1', externalJobNo: 'N1', doNo: 'D1', shNo: 'S1', externalVersion: '3', title: 'T', teamRef: 'T1',
      status: 1, rawStatus: 'NEW', checkOutAt: null, siteName: 'Site', siteAddress: 'Addr', siteLat: 13.7, siteLng: 100.5,
    });
    expect(s.externalUpdatedAt?.toISOString()).toBe('2026-11-25T03:00:00.000Z');
    expect(s.checkInAt?.toISOString()).toBe('2026-11-25T01:00:00.000Z');
    expect(s.payloadHash).toHaveLength(64);
  });

  it('missing optional fields become null; version absent ⇒ null', () => {
    const s = mapV1({ job: { jobId: 'J2', status: 'NEW', updatedAt: '2026-11-25T00:00:00Z' } });
    expect(s).toMatchObject({ externalVersion: null, externalJobNo: null, siteName: null, siteLat: null, deviceRefs: [], plannedStartAt: null });
  });
});

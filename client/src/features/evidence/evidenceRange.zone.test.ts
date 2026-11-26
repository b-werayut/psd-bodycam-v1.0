// The range fields are Bangkok wall time whatever the browser zone.
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'America/New_York';

import { describe, expect, it } from 'vitest';

import { bangkokLocalInput, fromBangkokLocalInput, validateEvidenceRange } from './evidenceRange';

describe('Bangkok range field under a non-Bangkok zone', () => {
  it('runs in another zone', () => {
    expect(new Date('2026-11-26T12:00:00Z').getHours()).not.toBe(19);
  });

  it('shows an instant as Bangkok wall time with seconds', () => {
    expect(bangkokLocalInput('2026-11-26T17:40:00Z')).toBe('2026-11-27T00:40:00');
    expect(bangkokLocalInput(new Date('2026-11-26T17:40:07Z'))).toBe('2026-11-27T00:40:07');
  });

  it('round-trips to the same ISO', () => {
    const iso = '2026-11-26T17:40:07.000Z';
    expect(fromBangkokLocalInput(bangkokLocalInput(iso))).toBe(iso);
  });

  it('accepts a value without seconds and rejects junk', () => {
    expect(fromBangkokLocalInput('2026-11-27T00:40')).toBe('2026-11-26T17:40:00.000Z');
    expect(fromBangkokLocalInput('')).toBe('');
    expect(fromBangkokLocalInput('nope')).toBe('');
  });

  it('validates field values as Bangkok time', () => {
    const now = new Date('2026-11-26T08:00:00Z');
    expect(validateEvidenceRange({ from: '2026-11-26T10:00:00', to: '2026-11-26T09:00:00' }, now)).toBe('evidence.errorRangeOrder');
    expect(validateEvidenceRange({ from: '2026-11-25T10:00:00', to: '2026-11-26T10:00:00' }, now)).toBeNull();
    expect(validateEvidenceRange({ from: '2026-11-26T22:00:00', to: '2026-11-26T23:00:00' }, now)).toBe('evidence.errorRangeFuture');
  });
});

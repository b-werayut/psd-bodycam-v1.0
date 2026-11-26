import { describe, expect, it } from 'vitest';
import { AppException } from '../../common/errors/app-exception';
import {
  EVIDENCE_EXPORT_STATUS,
  EXPORT_TTL_MS,
  assertExportRange,
  exportFileName,
  isReusableExport,
  segmentProgress,
} from './evidence-export-rules';

const NOW = new Date('2026-11-26T10:00:00Z');
const at = (iso: string) => new Date(iso);

function rangeError(start: Date, end: Date, max = 120): AppException {
  try {
    assertExportRange(start, end, max, NOW);
  } catch (e) {
    return e as AppException;
  }
  throw new Error('expected INVALID_RANGE');
}

describe('assertExportRange', () => {
  it('accepts a range inside the cap', () => {
    expect(() => assertExportRange(at('2026-11-26T08:00:00Z'), at('2026-11-26T10:00:00Z'), 120, NOW)).not.toThrow();
  });

  it('rejects over the cap and names the minutes', () => {
    const e = rangeError(at('2026-11-26T07:00:00Z'), at('2026-11-26T09:01:00Z'));
    expect(e.getStatus()).toBe(400);
    expect(JSON.stringify(e.getResponse())).toContain('INVALID_RANGE');
    expect(e.message).toContain('120');
  });

  it('uses the cap argument', () => {
    expect(() => assertExportRange(at('2026-11-26T08:00:00Z'), at('2026-11-26T08:30:00Z'), 20, NOW)).toThrow(/20/);
  });

  it('rejects reversed, equal and NaN', () => {
    expect(() => assertExportRange(at('2026-11-26T09:00:00Z'), at('2026-11-26T08:00:00Z'), 120, NOW)).toThrow(AppException);
    expect(() => assertExportRange(at('2026-11-26T09:00:00Z'), at('2026-11-26T09:00:00Z'), 120, NOW)).toThrow(AppException);
    expect(() => assertExportRange(new Date(NaN), at('2026-11-26T09:00:00Z'), 120, NOW)).toThrow(AppException);
  });

  it('rejects an end more than 5 minutes in the future, allows 5', () => {
    expect(() => assertExportRange(at('2026-11-26T09:30:00Z'), at('2026-11-26T10:06:00Z'), 120, NOW)).toThrow(AppException);
    expect(() => assertExportRange(at('2026-11-26T09:30:00Z'), at('2026-11-26T10:05:00Z'), 120, NOW)).not.toThrow();
  });

  it('rejects a start before the earliest recording day', () => {
    // earliest = 00:00 Bangkok 29 days back = 2026-10-27T17:00:00Z
    expect(() => assertExportRange(at('2026-10-27T16:59:00Z'), at('2026-10-27T17:30:00Z'), 120, NOW)).toThrow(AppException);
    expect(() => assertExportRange(at('2026-10-27T17:00:00Z'), at('2026-10-27T17:30:00Z'), 120, NOW)).not.toThrow();
  });
});

describe('isReusableExport', () => {
  const future = new Date(NOW.getTime() + 1000);
  const past = new Date(NOW.getTime() - 1000);
  it('queued and processing are reusable', () => {
    expect(isReusableExport({ Status: EVIDENCE_EXPORT_STATUS.QUEUED, ExpiresAt: null }, NOW)).toBe(true);
    expect(isReusableExport({ Status: EVIDENCE_EXPORT_STATUS.PROCESSING, ExpiresAt: null }, NOW)).toBe(true);
  });
  it('ready only while unexpired', () => {
    expect(isReusableExport({ Status: EVIDENCE_EXPORT_STATUS.READY, ExpiresAt: future }, NOW)).toBe(true);
    expect(isReusableExport({ Status: EVIDENCE_EXPORT_STATUS.READY, ExpiresAt: past }, NOW)).toBe(false);
    expect(isReusableExport({ Status: EVIDENCE_EXPORT_STATUS.READY, ExpiresAt: null }, NOW)).toBe(false);
  });
  it('failed and expired never', () => {
    expect(isReusableExport({ Status: EVIDENCE_EXPORT_STATUS.FAILED, ExpiresAt: future }, NOW)).toBe(false);
    expect(isReusableExport({ Status: EVIDENCE_EXPORT_STATUS.EXPIRED, ExpiresAt: future }, NOW)).toBe(false);
  });
});

describe('exportFileName / segmentProgress / constants', () => {
  it('names the file in Bangkok time, ASCII', () => {
    expect(exportFileName({ deviceCode: '1000027', startAt: new Date('2026-11-25T10:06:30Z') })).toBe(
      'evidence_1000027_20261125-170630.mp4',
    );
  });
  it('sanitises the device code', () => {
    expect(exportFileName({ deviceCode: 'cam 1/x', startAt: new Date('2026-11-25T10:06:30Z') })).toBe(
      'evidence_cam-1-x_20261125-170630.mp4',
    );
  });
  it('segmentProgress caps at 95', () => {
    expect(segmentProgress(5, 10)).toBe(47);
    expect(segmentProgress(10, 10)).toBe(95);
    expect(segmentProgress(0, 0)).toBe(0);
  });
  it('status values are frozen', () => {
    expect(EVIDENCE_EXPORT_STATUS).toEqual({ QUEUED: 1, PROCESSING: 2, READY: 3, FAILED: 4, EXPIRED: 5 });
    expect(EXPORT_TTL_MS).toBe(86_400_000);
  });
});

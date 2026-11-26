import { describe, expect, it } from 'vitest';
import { AppException } from '../../common/errors/app-exception';
import {
  FUTURE_SKEW_MS,
  PLAYBACK_MAX_RANGE_HOURS,
  RECORDING_MAX_DAYS_BACK,
  assertRecordingRange,
  dssDaysBackFor,
  earliestRecordingFrom,
} from './recording-range';

const NOW = new Date('2026-11-26T09:37:00Z');
const HOUR = 3_600_000;

const codeOf = (fn: () => void) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(400);
    return (error as AppException).code;
  }
  return null;
};

describe('recording-range constants', () => {
  it('uses the agreed limits', () => {
    expect(RECORDING_MAX_DAYS_BACK).toBe(30);
    expect(PLAYBACK_MAX_RANGE_HOURS).toBe(24);
    expect(FUTURE_SKEW_MS).toBe(5 * 60_000);
  });
});

describe('earliestRecordingFrom', () => {
  it('is 00:00 Bangkok of the day 29 days before today', () => {
    expect(earliestRecordingFrom(NOW).toISOString()).toBe('2026-10-27T17:00:00.000Z');
  });

  it('uses the Bangkok date, not the UTC date, around midnight', () => {
    // 2026-11-26T18:00Z is already 2026-11-27 01:00 in Bangkok
    expect(earliestRecordingFrom(new Date('2026-11-26T18:00:00Z')).toISOString()).toBe('2026-10-28T17:00:00.000Z');
  });
});

describe('assertRecordingRange', () => {
  const oldest = earliestRecordingFrom(NOW);

  it('accepts the oldest day 00:00-24:00 and today 00:00-now', () => {
    expect(() => assertRecordingRange(oldest, new Date(oldest.getTime() + 24 * HOUR), NOW)).not.toThrow();
    const todayStart = new Date('2026-11-25T17:00:00Z');
    expect(() => assertRecordingRange(todayStart, NOW, NOW)).not.toThrow();
  });

  it('rejects NaN', () => {
    expect(codeOf(() => assertRecordingRange(new Date('x'), NOW, NOW))).toBe('INVALID_RANGE');
    expect(codeOf(() => assertRecordingRange(oldest, new Date('x'), NOW))).toBe('INVALID_RANGE');
  });

  it('rejects to <= from', () => {
    const from = new Date(NOW.getTime() - HOUR);
    expect(codeOf(() => assertRecordingRange(from, from, NOW))).toBe('INVALID_RANGE');
    expect(codeOf(() => assertRecordingRange(from, new Date(from.getTime() - 1), NOW))).toBe('INVALID_RANGE');
  });

  it('rejects more than 24 h', () => {
    const from = new Date(NOW.getTime() - 30 * HOUR);
    expect(codeOf(() => assertRecordingRange(from, new Date(from.getTime() + 24 * HOUR + 1), NOW))).toBe('INVALID_RANGE');
  });

  it('rejects from before the earliest day', () => {
    const from = new Date(oldest.getTime() - 1);
    expect(codeOf(() => assertRecordingRange(from, new Date(from.getTime() + HOUR), NOW))).toBe('INVALID_RANGE');
  });

  it('rejects from beyond now + skew', () => {
    const from = new Date(NOW.getTime() + FUTURE_SKEW_MS + 1);
    expect(codeOf(() => assertRecordingRange(from, new Date(from.getTime() + HOUR), NOW))).toBe('INVALID_RANGE');
  });
});

describe('dssDaysBackFor', () => {
  it('covers the oldest selectable day with the 30 day cap', () => {
    const from = earliestRecordingFrom(NOW);
    expect(dssDaysBackFor(from, NOW)).toBe(30);
    expect(NOW.getTime() - 30 * 86_400_000).toBeLessThanOrEqual(from.getTime());
  });

  it('is 2 for two hours ago and never below 1', () => {
    expect(dssDaysBackFor(new Date(NOW.getTime() - 2 * HOUR), NOW)).toBe(2);
    expect(dssDaysBackFor(new Date(NOW.getTime() + HOUR), NOW)).toBeGreaterThanOrEqual(1);
  });
});

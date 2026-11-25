import { describe, expect, it } from 'vitest';
import { parseHistoryRange } from './history-range';

const now = new Date('2026-11-23T03:00:00Z');
const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

describe('parseHistoryRange', () => {
  it('accepts up to 36 hours and returns Dates', () => {
    expect(parseHistoryRange('2026-11-21T15:00:00Z', '2026-11-23T03:00:00Z', now)).toEqual({
      from: new Date('2026-11-21T15:00:00Z'),
      to: new Date('2026-11-23T03:00:00Z'),
    });
  });

  it('INVALID_RANGE: unreadable dates, end not after start, more than 36 h, a start in the future', () => {
    expect(codeOf(() => parseHistoryRange('yesterday', '2026-11-23T03:00:00Z', now))).toBe('INVALID_RANGE');
    expect(codeOf(() => parseHistoryRange('2026-11-23T03:00:00Z', '2026-11-23T03:00:00Z', now))).toBe('INVALID_RANGE');
    expect(codeOf(() => parseHistoryRange('2026-11-21T14:59:59Z', '2026-11-23T03:00:00Z', now))).toBe('INVALID_RANGE');
    expect(codeOf(() => parseHistoryRange('2026-11-23T03:06:00Z', '2026-11-23T04:00:00Z', now))).toBe('INVALID_RANGE');
  });

  it('the too-long message names the 36 hour limit', () => {
    expect(() => parseHistoryRange('2026-11-21T14:59:59Z', '2026-11-23T03:00:00Z', now)).toThrow('ไม่เกิน 36 ชั่วโมง');
  });

  it('a start up to 5 minutes ahead (clock skew) is fine', () => {
    expect(codeOf(() => parseHistoryRange('2026-11-23T03:04:00Z', '2026-11-23T04:00:00Z', now))).toBeNull();
  });
});

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
  it('accepts up to 24 hours and returns Dates', () => {
    expect(parseHistoryRange('2026-11-22T03:00:00Z', '2026-11-23T03:00:00Z', now)).toEqual({
      from: new Date('2026-11-22T03:00:00Z'),
      to: new Date('2026-11-23T03:00:00Z'),
    });
  });

  it('INVALID_RANGE: unreadable dates, end not after start, more than 24 h, a start in the future', () => {
    expect(codeOf(() => parseHistoryRange('yesterday', '2026-11-23T03:00:00Z', now))).toBe('INVALID_RANGE');
    expect(codeOf(() => parseHistoryRange('2026-11-23T03:00:00Z', '2026-11-23T03:00:00Z', now))).toBe('INVALID_RANGE');
    expect(codeOf(() => parseHistoryRange('2026-11-22T02:59:59Z', '2026-11-23T03:00:00Z', now))).toBe('INVALID_RANGE');
    expect(codeOf(() => parseHistoryRange('2026-11-23T03:06:00Z', '2026-11-23T04:00:00Z', now))).toBe('INVALID_RANGE');
  });

  it('a start up to 5 minutes ahead (clock skew) is fine', () => {
    expect(codeOf(() => parseHistoryRange('2026-11-23T03:04:00Z', '2026-11-23T04:00:00Z', now))).toBeNull();
  });
});

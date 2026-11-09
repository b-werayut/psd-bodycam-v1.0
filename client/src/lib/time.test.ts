import { describe, expect, it } from 'vitest';

import {
  DISPLAY_TIME_ZONE,
  dayBoundsBangkok,
  formatDateTime,
  formatDayMonth,
  formatTime,
} from './time';

// Every expectation is fixed in Asia/Bangkok (UTC+7, no DST), so the result must not depend on
// the machine's time zone. 17:30:05Z is already 00:30:05 on the next day in Bangkok.
const LATE_UTC = '2026-11-04T17:30:05.000Z';

describe('time helpers (Asia/Bangkok)', () => {
  it('displays in Asia/Bangkok', () => {
    expect(DISPLAY_TIME_ZONE).toBe('Asia/Bangkok');
  });

  describe('dayBoundsBangkok', () => {
    it('gives the UTC instants of 00:00:00.000 and 23:59:59.999 Bangkok time', () => {
      expect(dayBoundsBangkok('2026-11-04')).toEqual({
        from: '2026-11-03T17:00:00.000Z',
        to: '2026-11-04T16:59:59.999Z',
      });
    });

    it('crosses month and year boundaries', () => {
      expect(dayBoundsBangkok('2026-01-01')).toEqual({
        from: '2025-12-31T17:00:00.000Z',
        to: '2026-01-01T16:59:59.999Z',
      });
      expect(dayBoundsBangkok('2028-02-29').from).toBe('2028-02-28T17:00:00.000Z');
    });

    it('rejects malformed or impossible dates instead of rolling them over', () => {
      for (const bad of ['', '2026-11-4', '04/11/2026', '2026-02-30', '2026-13-01', 'x']) {
        expect(() => dayBoundsBangkok(bad), bad).toThrow(RangeError);
      }
    });
  });

  describe('formatDateTime', () => {
    it('formats in Bangkok time, Thai and English', () => {
      expect(formatDateTime(LATE_UTC, 'th')).toBe('5/11/69 00:30');
      expect(formatDateTime(LATE_UTC, 'en')).toBe('05/11/2026, 00:30');
    });

    it('can include seconds', () => {
      expect(formatDateTime(LATE_UTC, 'en', { seconds: true })).toBe('05/11/2026, 00:30:05');
    });

    it('returns an unparseable value unchanged', () => {
      expect(formatDateTime('not-a-date', 'th')).toBe('not-a-date');
    });
  });

  describe('formatTime / formatDayMonth (header clock)', () => {
    it('24-hour HH:mm in Bangkok time', () => {
      expect(formatTime(new Date(LATE_UTC), 'th')).toBe('00:30');
      expect(formatTime(new Date('2026-11-04T08:05:00.000Z'), 'en')).toBe('15:05');
    });

    it('day and short month in Bangkok time (the date flips at Bangkok midnight)', () => {
      expect(formatDayMonth(new Date(LATE_UTC), 'en')).toBe('5 Nov');
      expect(formatDayMonth(new Date(LATE_UTC), 'th')).toBe('5 พ.ย.');
      expect(formatDayMonth(new Date('2026-11-04T16:59:59.000Z'), 'en')).toBe('4 Nov');
    });
  });
});

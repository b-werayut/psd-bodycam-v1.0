import { describe, expect, it } from 'vitest';

import {
  bangkokDateOf,
  bangkokInstant,
  dayWindowOf,
  historyHref,
  historySearch,
  isFutureDay,
  parseHistoryQuery,
  rangeFieldsOf,
  rangeProblem,
  shiftDay,
  shiftWindow,
  spansDays,
  windowOfFields,
} from './historyRange';

const now = new Date('2026-11-23T03:00:00Z'); // 10:00 in Bangkok

describe('Bangkok day windows', () => {
  it('a day is 00:00–24:00 Asia/Bangkok whatever the browser zone', () => {
    expect(dayWindowOf('2026-11-23')).toEqual({ from: '2026-11-22T17:00:00.000Z', to: '2026-11-23T17:00:00.000Z' });
  });

  it('bangkokDateOf / shiftDay / isFutureDay', () => {
    expect(bangkokDateOf(new Date('2026-11-22T18:00:00Z'))).toBe('2026-11-23');
    expect(shiftDay('2026-12-01', -1)).toBe('2026-11-30');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(isFutureDay('2026-11-23', now)).toBe(false);
    expect(isFutureDay('2026-11-24', now)).toBe(true);
  });
});

describe('Bangkok date + time fields', () => {
  it('bangkokInstant: Bangkok wall time -> UTC, whatever the browser zone', () => {
    expect(bangkokInstant('2026-11-24', '20:00')).toBe('2026-11-24T13:00:00.000Z');
    expect(bangkokInstant('2026-11-25', '06:30')).toBe('2026-11-24T23:30:00.000Z');
    expect(bangkokInstant('2026-02-30', '10:00')).toBeNull();
    expect(bangkokInstant('2026-11-24', '')).toBeNull();
    expect(bangkokInstant('', '10:00')).toBeNull();
  });

  it('rangeFieldsOf <-> windowOfFields round-trip, crossing midnight', () => {
    const window = { from: '2026-11-21T13:00:00.000Z', to: '2026-11-21T23:00:00.000Z' };
    expect(rangeFieldsOf(window)).toEqual({ startDate: '2026-11-21', startTime: '20:00', endDate: '2026-11-22', endTime: '06:00' });
    expect(windowOfFields(rangeFieldsOf(window))).toEqual(window);
  });

  it('preserves selected seconds across Bangkok conversion and range field updates', () => {
    expect(bangkokInstant('2026-11-24', '20:00:15')).toBe('2026-11-24T13:00:15.000Z');
    expect(bangkokInstant('2026-11-24', '20:00:60')).toBeNull();
    const window = { from: '2026-11-21T13:00:15.000Z', to: '2026-11-21T23:00:45.000Z' };
    const fields = rangeFieldsOf(window);
    expect(fields).toEqual({ startDate: '2026-11-21', startTime: '20:00:15', endDate: '2026-11-22', endTime: '06:00:45' });
    expect(windowOfFields(fields)).toEqual(window);
  });

  it('a whole day ends at 00:00 of the next day', () => {
    expect(rangeFieldsOf(dayWindowOf('2026-11-22'))).toEqual({
      startDate: '2026-11-22',
      startTime: '00:00',
      endDate: '2026-11-23',
      endTime: '00:00',
    });
  });

  it('an empty field gives no window', () => {
    expect(windowOfFields({ startDate: '2026-11-22', startTime: '', endDate: '2026-11-23', endTime: '00:00' })).toBeNull();
  });
});

describe('rangeProblem', () => {
  const at = (from: string, to: string) => ({ from, to });

  it('null when valid; exactly 36 h is valid', () => {
    expect(rangeProblem(at('2026-11-21T15:00:00.000Z', '2026-11-23T03:00:00.000Z'), now)).toBeNull();
  });

  it('incomplete, endBeforeStart, tooLong, future', () => {
    expect(rangeProblem(null, now)).toBe('incomplete');
    expect(rangeProblem(at('2026-11-22T10:00:00.000Z', '2026-11-22T10:00:00.000Z'), now)).toBe('endBeforeStart');
    expect(rangeProblem(at('2026-11-21T14:59:00.000Z', '2026-11-23T03:00:00.000Z'), now)).toBe('tooLong');
    expect(rangeProblem(at('2026-11-23T03:01:00.000Z', '2026-11-23T05:00:00.000Z'), now)).toBe('future');
  });
});

describe('shiftWindow / spansDays', () => {
  it('shifts the whole window by days', () => {
    expect(shiftWindow({ from: '2026-11-21T13:00:00.000Z', to: '2026-11-21T23:00:00.000Z' }, -1)).toEqual({
      from: '2026-11-20T13:00:00.000Z',
      to: '2026-11-20T23:00:00.000Z',
    });
  });

  it('a whole day does not span days; 20:00 -> 06:00 does', () => {
    expect(spansDays(dayWindowOf('2026-11-22'))).toBe(false);
    expect(spansDays({ from: '2026-11-21T13:00:00.000Z', to: '2026-11-21T23:00:00.000Z' })).toBe(true);
  });
});

describe('parseHistoryQuery', () => {
  it('keeps a valid range of at most 36 h', () => {
    const q = parseHistoryQuery(new URLSearchParams('deviceId=7&from=2026-11-21T17:00:00.000Z&to=2026-11-22T17:00:00.000Z'), now);
    expect(q).toEqual({ deviceId: '7', from: '2026-11-21T17:00:00.000Z', to: '2026-11-22T17:00:00.000Z' });
    const longest = parseHistoryQuery(new URLSearchParams('from=2026-11-21T15:00:00.000Z&to=2026-11-23T03:00:00.000Z'), now);
    expect(longest).toEqual({ deviceId: null, from: '2026-11-21T15:00:00.000Z', to: '2026-11-23T03:00:00.000Z' });
  });

  it('a range one minute over 36 h falls back to today', () => {
    const q = parseHistoryQuery(new URLSearchParams('from=2026-11-21T14:59:00.000Z&to=2026-11-23T03:00:00.000Z'), now);
    expect(q).toEqual({ deviceId: null, ...dayWindowOf('2026-11-23') });
  });

  it('missing, broken, too long or future ranges fall back to today', () => {
    const today = dayWindowOf('2026-11-23');
    for (const search of [
      '',
      'from=x&to=y',
      'from=2026-11-20T00:00:00.000Z&to=2026-11-22T00:00:00.000Z',
      'from=2026-11-25T00:00:00.000Z&to=2026-11-25T10:00:00.000Z',
    ]) {
      expect(parseHistoryQuery(new URLSearchParams(search), now)).toMatchObject({ deviceId: null, ...today });
    }
  });
});

describe('links', () => {
  it('historySearch keeps deviceId, from, to', () => {
    expect(historySearch({ deviceId: '7', from: 'a', to: 'b' })).toBe('deviceId=7&from=a&to=b');
  });

  it('historyHref: no time = today; a long work window = its last 36 h', () => {
    expect(historyHref({ deviceId: '7', now })).toBe(
      '/tracking/history?deviceId=7&from=2026-11-22T17%3A00%3A00.000Z&to=2026-11-23T17%3A00%3A00.000Z',
    );
    expect(
      historyHref({ deviceId: '7', startAt: '2026-11-20T00:00:00.000Z', endAt: '2026-11-22T12:00:00.000Z', now }),
    ).toBe('/tracking/history?deviceId=7&from=2026-11-21T00%3A00%3A00.000Z&to=2026-11-22T12%3A00%3A00.000Z');
  });
});

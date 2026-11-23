import { describe, expect, it } from 'vitest';

import {
  bangkokDateOf,
  dayWindowOf,
  historyHref,
  historySearch,
  isFutureDay,
  parseHistoryQuery,
  shiftDay,
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

describe('parseHistoryQuery', () => {
  it('keeps a valid range of at most 24 h', () => {
    const q = parseHistoryQuery(new URLSearchParams('deviceId=7&from=2026-11-21T17:00:00.000Z&to=2026-11-22T17:00:00.000Z'), now);
    expect(q).toEqual({ deviceId: '7', from: '2026-11-21T17:00:00.000Z', to: '2026-11-22T17:00:00.000Z' });
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

  it('historyHref: no time = today; a long work window = its last 24 h', () => {
    expect(historyHref({ deviceId: '7', now })).toBe(
      '/tracking/history?deviceId=7&from=2026-11-22T17%3A00%3A00.000Z&to=2026-11-23T17%3A00%3A00.000Z',
    );
    expect(
      historyHref({ deviceId: '7', startAt: '2026-11-20T00:00:00.000Z', endAt: '2026-11-22T12:00:00.000Z', now }),
    ).toBe('/tracking/history?deviceId=7&from=2026-11-21T12%3A00%3A00.000Z&to=2026-11-22T12%3A00%3A00.000Z');
  });
});

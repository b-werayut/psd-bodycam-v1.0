import { describe, expect, it } from 'vitest';

import { clipToDay, dayRange, formatDuration, fromBangkokLocalInput, recordingDayPosition, selectableDays, validateEvidenceRange } from './evidenceRange';

const NOW = new Date('2026-11-26T08:00:00.000Z'); // 15:00 Bangkok

describe('recordingDayPosition', () => {
  it('positions recordings against the full Bangkok day, including today', () => {
    expect(recordingDayPosition({
      startAt: '2026-11-25T23:00:00.000Z', // 06:00 Bangkok
      endAt: '2026-11-26T02:00:00.000Z', // 09:00 Bangkok
    }, '2026-11-26')).toEqual({ left: 25, width: 12.5 });
  });

  it('clips a recording crossing the beginning or end of the selected day', () => {
    const before = recordingDayPosition({
      startAt: '2026-11-25T16:30:00.000Z', endAt: '2026-11-25T17:20:00.000Z',
    }, '2026-11-26');
    expect(before?.left).toBe(0);
    expect(before?.width).toBeCloseTo(1.388889);
    const after = recordingDayPosition({
      startAt: '2026-11-26T16:50:00.000Z', endAt: '2026-11-26T18:00:00.000Z',
    }, '2026-11-26');
    expect(after?.left).toBeCloseTo(99.305556);
    expect(after?.width).toBeCloseTo(0.694444);
  });

  it('does not draw invalid, reversed, or non-overlapping intervals', () => {
    for (const recording of [
      { startAt: 'invalid', endAt: '2026-11-26T02:00:00.000Z' },
      { startAt: '2026-11-26T02:00:00.000Z', endAt: '2026-11-26T01:00:00.000Z' },
      { startAt: '2026-11-25T16:00:00.000Z', endAt: '2026-11-25T17:00:00.000Z' },
    ]) expect(recordingDayPosition(recording, '2026-11-26')).toBeNull();
  });
});

describe('selectableDays', () => {
  it('lists 30 Bangkok dates, today first', () => {
    const days = selectableDays(NOW);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2026-11-26');
    expect(days[1]).toBe('2026-11-25');
    expect(days[29]).toBe('2026-10-28');
  });

  it('uses the Bangkok date even when UTC is still yesterday', () => {
    expect(selectableDays(new Date('2026-11-25T20:00:00.000Z'))[0]).toBe('2026-11-26');
  });
});

describe('dayRange', () => {
  it('caps today at now', () => {
    expect(dayRange('2026-11-26', NOW)).toEqual({ from: '2026-11-25T17:00:00.000Z', to: NOW.toISOString() });
  });
  it('gives a past day 00:00-24:00 Bangkok', () => {
    expect(dayRange('2026-11-25', NOW)).toEqual({ from: '2026-11-24T17:00:00.000Z', to: '2026-11-25T17:00:00.000Z' });
  });
});

describe('clipToDay', () => {
  const day = { from: '2026-11-25T17:00:00.000Z', to: '2026-11-26T17:00:00.000Z' };
  it('clips a file that started yesterday to 00:00 of the day', () => {
    expect(clipToDay({ startAt: '2026-11-25T16:30:00.000Z', endAt: '2026-11-25T17:40:00.000Z' }, day)).toEqual({
      startAt: '2026-11-25T17:00:00.000Z',
      endAt: '2026-11-25T17:40:00.000Z',
    });
  });
  it('clips the end to the day end', () => {
    expect(clipToDay({ startAt: '2026-11-26T16:00:00.000Z', endAt: '2026-11-26T18:00:00.000Z' }, day).endAt).toBe(day.to);
  });
  it('leaves a file inside the day unchanged', () => {
    const file = { startAt: '2026-11-26T01:00:00.000Z', endAt: '2026-11-26T02:00:00.000Z' };
    expect(clipToDay(file, day)).toEqual(file);
  });
});

describe('validateEvidenceRange', () => {
  it('flags empty, reversed and too long', () => {
    expect(validateEvidenceRange({ from: '', to: '' }, NOW)).toBe('evidence.errorRangeRequired');
    expect(validateEvidenceRange({ from: '2026-11-26T10:00:00', to: '2026-11-26T09:00:00' }, NOW)).toBe('evidence.errorRangeOrder');
    expect(validateEvidenceRange({ from: '2026-11-24T10:00:00', to: '2026-11-25T10:00:01' }, NOW)).toBe('evidence.errorRangeTooLong');
  });
  it('accepts exactly 24 h', () => {
    expect(validateEvidenceRange({ from: '2026-11-24T10:00:00', to: '2026-11-25T10:00:00' }, NOW)).toBeNull();
  });
});

describe('helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(null)).toBe('—');
  });

  it('reads datetime-local values with or without seconds / milliseconds', () => {
    expect(fromBangkokLocalInput('2026-11-26T07:00')).toBe('2026-11-26T00:00:00.000Z');
    expect(fromBangkokLocalInput('2026-11-26T07:00:30')).toBe('2026-11-26T00:00:30.000Z');
    expect(fromBangkokLocalInput('2026-11-26T07:00:30.000')).toBe('2026-11-26T00:00:30.000Z');
    expect(fromBangkokLocalInput('nope')).toBe('');
  });
});

import { describe, expect, it } from 'vitest';

import { isStaleFix, positionAge } from './positionAge';

const now = Date.parse('2026-11-23T03:00:00Z');
const ago = (s: number) => new Date(now - s * 1000).toISOString();

describe('positionAge', () => {
  it('now / minutes / hours / days', () => {
    expect(positionAge(ago(30), now)).toEqual({ key: 'tracking.age.now', n: 0 });
    expect(positionAge(ago(600), now)).toEqual({ key: 'tracking.age.minutes', n: 10 });
    expect(positionAge(ago(7200), now)).toEqual({ key: 'tracking.age.hours', n: 2 });
    expect(positionAge(ago(3 * 86_400), now)).toEqual({ key: 'tracking.age.days', n: 3 });
  });
});

describe('isStaleFix', () => {
  it('older than fixActiveSeconds, or no fix at all', () => {
    expect(isStaleFix(ago(150), 150, now)).toBe(false);
    expect(isStaleFix(ago(151), 150, now)).toBe(true);
    expect(isStaleFix(null, 150, now)).toBe(true);
  });
});

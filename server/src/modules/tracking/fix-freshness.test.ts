import { describe, expect, it } from 'vitest';
import { fixMaxAgeSeconds, isFreshFix } from './fix-freshness';

describe('fixMaxAgeSeconds', () => {
  it('= unknown-after + 2 × poll (defaults 120 + 2 × 15 = 150)', () => {
    expect(fixMaxAgeSeconds(120, 15)).toBe(150);
  });

  it('never below 1 s, a negative poll counts as 0', () => {
    expect(fixMaxAgeSeconds(0, 0)).toBe(1);
    expect(fixMaxAgeSeconds(30, -5)).toBe(30);
  });
});

describe('isFreshFix', () => {
  const now = new Date('2026-11-23T03:00:00Z');
  it('within the max age is fresh; older is not', () => {
    expect(isFreshFix(new Date(now.getTime() - 150_000), now, 150)).toBe(true);
    expect(isFreshFix(new Date(now.getTime() - 151_000), now, 150)).toBe(false);
  });

  it('a future time counts as fresh (the future filter is elsewhere)', () => {
    expect(isFreshFix(new Date(now.getTime() + 60_000), now, 150)).toBe(true);
  });
});

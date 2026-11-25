import { describe, expect, it } from 'vitest';

import { formatDistance } from './distance';

describe('formatDistance', () => {
  it('under 1 km: whole meters', () => {
    expect(formatDistance(0, 'th')).toMatch(/^0\sม\.$/);
    expect(formatDistance(849.6, 'th')).toMatch(/^850\sม\.$/);
    expect(formatDistance(999, 'en')).toMatch(/^999\sm$/);
  });

  it('1 km and over: kilometers with at most one decimal', () => {
    expect(formatDistance(1000, 'th')).toMatch(/^1\sกม\.$/);
    expect(formatDistance(2449, 'th')).toMatch(/^2\.4\sกม\.$/);
    expect(formatDistance(12_350, 'en')).toMatch(/^12\.4\skm$/);
  });

  it('rounding up to 1,000 m switches to kilometers', () => {
    expect(formatDistance(999.6, 'th')).toMatch(/^1\sกม\.$/);
  });
});

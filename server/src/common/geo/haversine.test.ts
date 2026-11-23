import { describe, expect, it } from 'vitest';
import { haversineMeters } from './haversine';

describe('haversineMeters', () => {
  it('is 0 for the same point', () => {
    expect(haversineMeters({ lat: 13.7563, lng: 100.5018 }, { lat: 13.7563, lng: 100.5018 })).toBe(0);
  });

  it('one degree of latitude is about 111.2 km', () => {
    const d = haversineMeters({ lat: 13, lng: 100 }, { lat: 14, lng: 100 });
    expect(d).toBeGreaterThan(111_100);
    expect(d).toBeLessThan(111_300);
  });

  it('Bangkok to Chiang Mai is about 583 km', () => {
    const d = haversineMeters({ lat: 13.7563, lng: 100.5018 }, { lat: 18.7883, lng: 98.9853 });
    expect(d / 1000).toBeGreaterThan(575);
    expect(d / 1000).toBeLessThan(590);
  });
});

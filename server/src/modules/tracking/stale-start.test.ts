import { describe, expect, it } from 'vitest';
import { confirmsStaleStartLanding, STALE_START_RULES, type RoutePoint } from './stale-start';

// Ported from the reference route-builder.test.ts (real data: camera 1000027, 2026-10-22).
const T0 = new Date('2026-09-01T03:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
type Place = { lat: number; lng: number };
const A: Place = { lat: 13.75, lng: 100.5 };
const B: Place = { lat: 13.77, lng: 100.52 };
const shift = (place: Place, northM: number, eastM = 0): Place => ({
  lat: place.lat + northM / 110_540,
  lng: place.lng + eastM / (111_320 * Math.cos((place.lat * Math.PI) / 180)),
});
const p = (place: Place, s: number): RoutePoint => ({ at: at(s), ...place });

describe('confirmsStaleStartLanding (at ingest)', () => {
  const GAP = 90;
  const OLD = shift(A, -5000, -3000);
  const NEAR_A = shift(A, 230, 160);

  it('rules: 250 m, 3 points, 300 s, 30 km/h, factor 5', () => {
    expect(STALE_START_RULES).toEqual({ minDistanceM: 250, maxPoints: 3, maxSeconds: 300, minKph: 30, contextFactor: 5 });
  });

  it('stale point → new position 55 s later → next point confirms ⇒ true', () => {
    expect(confirmsStaleStartLanding([p(B, -7 * 86_400), p(OLD, 0), p(A, 55)], p(NEAR_A, 99), GAP, false)).toBe(true);
  });

  it('two stale points before the new position ⇒ true', () => {
    expect(confirmsStaleStartLanding([p(B, -3600), p(OLD, 0), p(OLD, 40), p(A, 95)], p(NEAR_A, 140), GAP, false)).toBe(true);
  });

  it("the camera's very first point counts only when it really is the first", () => {
    const recent = [p(OLD, 0), p(A, 55)];
    expect(confirmsStaleStartLanding(recent, p(NEAR_A, 99), GAP, true)).toBe(true);
    expect(confirmsStaleStartLanding(recent, p(NEAR_A, 99), GAP, false)).toBe(false);
  });

  it('a jump in the middle of the day (not after a signal gap) stays suspect ⇒ false', () => {
    const recent = [p(A, 0), p(A, 40), p(A, 80), p(OLD, 120)];
    expect(confirmsStaleStartLanding(recent, p(shift(OLD, 200), 160), GAP, false)).toBe(false);
  });

  it('the next point does not confirm (keeps travelling as far) ⇒ false', () => {
    expect(confirmsStaleStartLanding([p(B, -3600), p(OLD, 0), p(A, 55)], p(shift(A, 3000), 99), GAP, false)).toBe(false);
  });

  it('new position more than 5 minutes after the stale point ⇒ false', () => {
    expect(confirmsStaleStartLanding([p(B, -3600), p(OLD, 0), p(A, 400)], p(NEAR_A, 440), GAP, false)).toBe(false);
  });
});

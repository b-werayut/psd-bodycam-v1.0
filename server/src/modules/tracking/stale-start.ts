import { haversineMeters } from '../../common/geo/haversine';

// "Stale position at connect" (port of the reference route-builder.ts): a camera that just came online
// first reports a position kilometres away (cached / unsettled), then settles minutes later. Shared by
// the ingest (`confirmsStaleStartLanding`) and the route builder (`staleRunAt`, Task 9).

export type RoutePoint = { at: Date; lat: number; lng: number };

/**
 * All must hold, against the next point after the run (the new position):
 * every run point ≥ `minDistanceM` from it and at most `maxPoints` points · reached within `maxSeconds`
 * · needs ≥ `minKph` to get there · the jump ≥ `contextFactor` × the following step (protects a car that
 * drives off right after the camera starts). No following point ⇒ not stale.
 */
export const STALE_START_RULES = {
  minDistanceM: 250,
  maxPoints: 3,
  maxSeconds: 300,
  minKph: 30,
  contextFactor: 5,
} as const;

export type StaleStartRules = { [K in keyof typeof STALE_START_RULES]: number };

export const secondsBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 1000);

export const metersBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  haversineMeters(a, b);

/** How many points from `start` (the first point of a signal run) are stale — 0 = none. */
export function staleRunAt(points: RoutePoint[], start: number, rules: StaleStartRules = STALE_START_RULES): number {
  for (let length = 1; length <= rules.maxPoints; length += 1) {
    const landing = points[start + length];
    if (!landing) return 0;
    const run = points.slice(start, start + length);
    if ((landing.at.getTime() - run[0].at.getTime()) / 1000 > rules.maxSeconds) return 0;
    // still near the run = repeated stale point (or the real place): try a longer run
    if (run.some((point) => metersBetween(point, landing) < rules.minDistanceM)) continue;

    const last = run[run.length - 1];
    const jump = metersBetween(last, landing);
    const seconds = (landing.at.getTime() - last.at.getTime()) / 1000;
    if ((jump / seconds) * 3.6 < rules.minKph) continue;

    const after = points[start + length + 1];
    if (!after) continue;
    if (jump < rules.contextFactor * metersBetween(landing, after)) continue;
    return length;
  }
  return 0;
}

/**
 * The same rule at ingest, which only knows the past: `recent` = the camera's latest points (old → new)
 * before `next`. True when the last of `recent` is the new position after a stale start and `next`
 * confirms it. `firstIsDeviceStart` = the first of `recent` is the camera's very first point.
 */
export function confirmsStaleStartLanding(
  recent: RoutePoint[],
  next: RoutePoint,
  gapSeconds: number,
  firstIsDeviceStart: boolean,
  rules: StaleStartRules = STALE_START_RULES,
): boolean {
  const points = [...recent, next];
  const landing = points.length - 2;
  for (let length = 1; length <= rules.maxPoints; length += 1) {
    const start = landing - length;
    if (start < 0) return false;
    const startsSignal =
      start === 0 ? firstIsDeviceStart : secondsBetween(points[start - 1].at, points[start].at) > gapSeconds;
    if (startsSignal && staleRunAt(points, start, rules) === length) return true;
  }
  return false;
}

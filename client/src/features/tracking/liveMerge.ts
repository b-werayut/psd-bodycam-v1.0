import type { DeviceDisplayState } from '@/components/status/deviceStateTone';
import type { GpsPoint, PositionRow } from './tracking.api';

export type LiveDevice = {
  id: string;
  deviceCode: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
  speedKph: number | null;
  lastFixAt: string | null;
  platformState: DeviceDisplayState;
  platformStatusFetchedAt: string | null;
  /** moved by a `gps:batch` since the snapshot */
  live: boolean;
};

export function devicesFromSnapshot(rows: readonly PositionRow[]): LiveDevice[] {
  return rows.map((row) => ({
    id: row.deviceId,
    deviceCode: row.deviceCode,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    speedKph: row.speedKph,
    lastFixAt: row.lastFixAt,
    platformState: row.platformState,
    platformStatusFetchedAt: row.platformStatusFetchedAt,
    live: false,
  }));
}

const timeOf = (iso: string | null) => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * Applies `gps:batch` points: only a point newer than the camera's last fix moves its marker (an older
 * batch arriving late never pulls it back). Status is not touched — GPS says nothing about it.
 * Returns the same array when nothing moved, so React skips the render.
 */
export function mergeGpsPoints(devices: readonly LiveDevice[], points: readonly GpsPoint[]): LiveDevice[] {
  const newest = new Map<string, GpsPoint>();
  for (const point of points) {
    const at = timeOf(point.recordedAt);
    if (at === null) continue;
    const seen = newest.get(point.deviceId);
    if (!seen || at > (timeOf(seen.recordedAt) ?? 0)) newest.set(point.deviceId, point);
  }

  let changed = false;
  const next = devices.map((device) => {
    const point = newest.get(device.id);
    if (!point) return device;
    const current = timeOf(device.lastFixAt);
    if (current !== null && (timeOf(point.recordedAt) ?? 0) <= current) return device;
    changed = true;
    return {
      ...device,
      lat: point.lat,
      lng: point.lng,
      speedKph: point.speedKph,
      lastFixAt: point.recordedAt,
      live: true,
    };
  });
  return changed ? next : (devices as LiveDevice[]);
}

/**
 * A refetched snapshot replaces the list (cameras added / removed, status), but a marker that a later
 * `gps:batch` already moved keeps its newer position — the snapshot is at most one poll cycle old.
 */
export function mergeSnapshot(prev: readonly LiveDevice[], snapshot: readonly LiveDevice[]): LiveDevice[] {
  const before = new Map(prev.map((d) => [d.id, d]));
  return snapshot.map((next) => {
    const old = before.get(next.id);
    const oldAt = old ? timeOf(old.lastFixAt) : null;
    const nextAt = timeOf(next.lastFixAt);
    if (!old || oldAt === null || (nextAt !== null && nextAt >= oldAt)) return next;
    return { ...next, lat: old.lat, lng: old.lng, speedKph: old.speedKph, lastFixAt: old.lastFixAt, live: old.live };
  });
}

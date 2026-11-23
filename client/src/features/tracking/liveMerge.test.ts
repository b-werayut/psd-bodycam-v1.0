import { describe, expect, it } from 'vitest';

import { devicesFromSnapshot, mergeGpsPoints, type LiveDevice } from './liveMerge';
import type { GpsPoint, PositionRow } from './tracking.api';

const row = (id: string, extra: Partial<PositionRow> = {}): PositionRow => ({
  deviceId: id,
  deviceCode: `SIM-${id}`,
  name: null,
  lat: 13.75,
  lng: 100.5,
  speedKph: null,
  heading: null,
  lastFixAt: '2026-11-23T03:00:00.000Z',
  fixValid: true,
  platformState: 'online',
  platformStatusFetchedAt: '2026-11-23T03:00:05.000Z',
  ...extra,
});
const point = (id: string, recordedAt: string, lat = 13.8): GpsPoint => ({
  deviceId: id,
  lat,
  lng: 100.6,
  speedKph: 5,
  heading: 90,
  recordedAt,
  isValidFix: true,
});

describe('devicesFromSnapshot', () => {
  it('maps the snapshot rows; nothing is live yet', () => {
    const [device] = devicesFromSnapshot([row('1', { name: 'กล้อง 1' })]);
    expect(device).toEqual<LiveDevice>({
      id: '1',
      deviceCode: 'SIM-1',
      name: 'กล้อง 1',
      lat: 13.75,
      lng: 100.5,
      speedKph: null,
      lastFixAt: '2026-11-23T03:00:00.000Z',
      platformState: 'online',
      platformStatusFetchedAt: '2026-11-23T03:00:05.000Z',
      live: false,
    });
  });
});

describe('mergeGpsPoints', () => {
  const devices = devicesFromSnapshot([row('1'), row('2', { lat: null, lng: null, lastFixAt: null })]);

  it('a newer point moves the marker and marks it live; status is untouched', () => {
    const next = mergeGpsPoints(devices, [point('1', '2026-11-23T03:00:15.000Z')]);
    expect(next[0]).toMatchObject({ lat: 13.8, lng: 100.6, speedKph: 5, lastFixAt: '2026-11-23T03:00:15.000Z', live: true });
    expect(next[0].platformState).toBe('online');
  });

  it('an older or equal point does not move the marker', () => {
    expect(mergeGpsPoints(devices, [point('1', '2026-11-23T02:59:00.000Z')])).toBe(devices);
    expect(mergeGpsPoints(devices, [point('1', '2026-11-23T03:00:00.000Z')])).toBe(devices);
  });

  it('a camera that had no fix gets its first one; unknown cameras are ignored', () => {
    const next = mergeGpsPoints(devices, [point('2', '2026-11-23T03:00:15.000Z'), point('99', '2026-11-23T03:00:15.000Z')]);
    expect(next[1]).toMatchObject({ lat: 13.8, live: true });
    expect(next).toHaveLength(2);
  });

  it('several points of one camera in a batch: the newest wins', () => {
    const next = mergeGpsPoints(devices, [
      point('1', '2026-11-23T03:00:30.000Z', 13.9),
      point('1', '2026-11-23T03:00:15.000Z', 13.8),
    ]);
    expect(next[0].lat).toBe(13.9);
  });
});

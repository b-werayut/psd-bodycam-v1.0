import { describe, expect, it } from 'vitest';

import {
  gridShapeFor, nextEmptySlot, paramsWithSlots, slotsFromParams,
  wallCameraBlocker, wallSlotState, withCameraPlaced, withLayout, withSlot,
} from './liveWall';
import type { WallDevice } from './streaming.api';

const camera = (deviceCode: string, extra: Partial<WallDevice> = {}): WallDevice => ({
  id: deviceCode, deviceCode, name: `กล้อง ${deviceCode}`, platformState: 'online',
  streamingEnabled: true, status: 1, ...extra,
});

describe('live wall arrangement', () => {
  it('defaults to six empty screens and preserves empty positions and other URL filters', () => {
    expect(slotsFromParams(new URLSearchParams())).toEqual(Array(6).fill(null));
    const params = paramsWithSlots(new URLSearchParams('q=camera'), ['A', null, 'B']);
    expect(params.get('q')).toBe('camera');
    expect(slotsFromParams(params)).toEqual(['A', null, 'B']);
  });

  it('does not open the same camera twice or exceed sixteen screens from a URL', () => {
    expect(slotsFromParams(new URLSearchParams('c=A&c=A&c=B'))).toEqual(['A', null, 'B']);
    expect(slotsFromParams(new URLSearchParams(Array.from({ length: 30 }, (_, i) => ['c', String(i)])))).toHaveLength(16);
  });

  it('swaps cameras when an occupied camera is dropped onto another screen', () => {
    expect(withCameraPlaced(['A', 'B', null], 1, 'A')).toEqual(['B', 'A', null]);
    expect(withCameraPlaced(['A', 'B', null], 2, 'A')).toEqual([null, 'B', 'A']);
  });

  it('keeps existing screens when expanding and removes trailing screens when shrinking', () => {
    expect(withLayout(['A', 'B'], 4)).toEqual(['A', 'B', null, null]);
    expect(withLayout(['A', 'B'], 1)).toEqual(['A']);
    expect(withSlot(['A', 'B'], 0, null)).toEqual([null, 'B']);
    expect(nextEmptySlot(['A', null, 'B', null], 1)).toBe(3);
    expect(nextEmptySlot(['A', 'B'], 0)).toBe(-1);
  });

  it.each([[1, 1, 1], [4, 2, 2], [6, 3, 2], [9, 3, 3], [16, 4, 4]])('lays out %i screens as %i by %i', (count, columns, rows) => {
    expect(gridShapeFor(count)).toEqual({ columns, rows });
  });
});

describe('live wall camera availability', () => {
  it('blocks offline, unknown, retired, and streaming-disabled cameras', () => {
    expect(wallCameraBlocker(camera('A', { platformState: 'offline' }))).toBe('liveWall.blocked.offline');
    expect(wallCameraBlocker(camera('A', { platformState: 'unknown' }))).toBe('liveWall.blocked.unknown');
    expect(wallCameraBlocker(camera('A', { streamingEnabled: false }))).toBe('streaming.blocked.disabled');
    expect(wallCameraBlocker(camera('A', { status: 4 }))).toBe('streaming.blocked.retired');
  });

  it('keeps offline cameras in their screens so they can resume when online', () => {
    const offline = camera('A', { platformState: 'offline' });
    expect(wallSlotState('A', [offline]).kind).toBe('offline');
    expect(wallSlotState('A', [camera('A')]).kind).toBe('ready');
    expect(wallSlotState('A', [])).toEqual({ kind: 'missing', code: 'A' });
    expect(wallSlotState('A', undefined)).toEqual({ kind: 'loading', code: 'A' });
  });
});

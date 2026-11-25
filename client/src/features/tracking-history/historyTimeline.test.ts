import { describe, expect, it } from 'vitest';

import type { RouteTimelineItem } from './history.api';
import { minutesOf, timelineView } from './historyTimeline';

describe('timelineView', () => {
  it('a stop: number, Bangkok clock times, minutes, no-signal minutes', () => {
    const stop: RouteTimelineItem = {
      kind: 'stop',
      index: 2,
      startAt: '2026-11-23T01:00:00.000Z',
      endAt: '2026-11-23T01:20:00.000Z',
      seconds: 1200,
      lat: 13.75,
      lng: 100.5,
      noSignalSeconds: 300,
      distanceFromPrevM: 2449,
      distanceFromPrevApprox: false,
    };
    expect(timelineView(stop, 'th')).toEqual({
      key: 'stop-2',
      kind: 'stop',
      labelKey: 'tracking.history.stop',
      params: { index: 2, from: '08:00', to: '08:20', minutes: 20 },
      distance: { key: 'tracking.history.distanceFromPrev', params: { distance: expect.stringMatching(/^2\.4\sกม\.$/) } },
      noSignal: { key: 'tracking.history.stopNoSignal', params: { minutes: 5 } },
      focus: [13.75, 100.5],
    });
  });

  const firstStop = (distanceFromPrevM: number, distanceFromPrevApprox = false): RouteTimelineItem => ({
    kind: 'stop',
    index: 1,
    startAt: '2026-11-23T01:00:00.000Z',
    endAt: '2026-11-23T01:20:00.000Z',
    seconds: 1200,
    lat: 13.75,
    lng: 100.5,
    noSignalSeconds: 0,
    distanceFromPrevM,
    distanceFromPrevApprox,
  });

  it('the first stop counts from the start; none when the route starts there', () => {
    expect(timelineView(firstStop(850), 'th').distance).toEqual({
      key: 'tracking.history.distanceFromStart',
      params: { distance: expect.stringMatching(/^850\sม\.$/) },
    });
    expect(timelineView(firstStop(0), 'th').distance).toBeNull();
  });

  it('a distance across a no-signal stretch is marked approximate', () => {
    expect(timelineView(firstStop(12_350, true), 'th').distance?.params.distance).toMatch(/^≈ 12\.4\sกม\.$/);
  });

  it('a gap focuses where the signal came back and shows its straight-line distance', () => {
    const gap: RouteTimelineItem = {
      kind: 'gap',
      startAt: '2026-11-23T02:00:00.000Z',
      endAt: '2026-11-23T02:30:00.000Z',
      seconds: 1800,
      from: { lat: 13.7, lng: 100.4 },
      to: { lat: 13.8, lng: 100.6 },
      distanceM: 1200,
    };
    expect(timelineView(gap, 'th')).toMatchObject({
      kind: 'gap',
      labelKey: 'tracking.history.gap',
      params: { from: '09:00', to: '09:30', minutes: 30 },
      distance: { key: 'tracking.history.gapDistance', params: { distance: expect.stringMatching(/^≈ 1\.2\sกม\.$/) } },
      focus: [13.8, 100.6],
    });
  });

  it('with dates when the window spans days', () => {
    const stop: RouteTimelineItem = {
      kind: 'stop',
      index: 1,
      startAt: '2026-11-23T01:00:00.000Z',
      endAt: '2026-11-23T01:20:00.000Z',
      seconds: 1200,
      lat: 13.75,
      lng: 100.5,
      noSignalSeconds: 0,
      distanceFromPrevM: 0,
      distanceFromPrevApprox: false,
    };
    const gap: RouteTimelineItem = {
      kind: 'gap',
      startAt: '2026-11-23T02:00:00.000Z',
      endAt: '2026-11-23T02:30:00.000Z',
      seconds: 1800,
      from: { lat: 13.7, lng: 100.4 },
      to: { lat: 13.8, lng: 100.6 },
      distanceM: 1200,
    };
    expect(timelineView(stop, 'th', true).params).toMatchObject({ from: '23 พ.ย. 08:00', to: '23 พ.ย. 08:20' });
    expect(timelineView(gap, 'th', true).params).toMatchObject({ from: '23 พ.ย. 09:00', to: '23 พ.ย. 09:30' });
    expect(timelineView(stop, 'th').params).toMatchObject({ from: '08:00', to: '08:20' });
  });

  it('minutes never show 0', () => {
    expect(minutesOf(10)).toBe(1);
    expect(minutesOf(90)).toBe(2);
  });
});

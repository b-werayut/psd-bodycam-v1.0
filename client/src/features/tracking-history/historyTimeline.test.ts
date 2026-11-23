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
    };
    expect(timelineView(stop, 'th')).toEqual({
      key: 'stop-2',
      kind: 'stop',
      labelKey: 'tracking.history.stop',
      params: { index: 2, from: '08:00', to: '08:20', minutes: 20 },
      noSignal: { key: 'tracking.history.stopNoSignal', params: { minutes: 5 } },
      focus: [13.75, 100.5],
    });
  });

  it('a gap focuses where the signal came back', () => {
    const gap: RouteTimelineItem = {
      kind: 'gap',
      startAt: '2026-11-23T02:00:00.000Z',
      endAt: '2026-11-23T02:30:00.000Z',
      seconds: 1800,
      from: { lat: 13.7, lng: 100.4 },
      to: { lat: 13.8, lng: 100.6 },
    };
    expect(timelineView(gap, 'th')).toMatchObject({
      kind: 'gap',
      labelKey: 'tracking.history.gap',
      params: { from: '09:00', to: '09:30', minutes: 30 },
      focus: [13.8, 100.6],
    });
  });

  it('minutes never show 0', () => {
    expect(minutesOf(10)).toBe(1);
    expect(minutesOf(90)).toBe(2);
  });
});

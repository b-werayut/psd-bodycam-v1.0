import type { TranslationKey } from '@/i18n/locales/th';
import type { Language } from '@/i18n/types';
import { formatDistance } from '@/lib/distance';
import { formatDayMonth, formatTime } from '@/lib/time';
import type { RouteTimelineItem } from './history.api';

export type TimelineView = {
  key: string;
  kind: 'stop' | 'gap';
  labelKey: TranslationKey;
  params: Record<string, string | number>;
  distance: { key: TranslationKey; params: { distance: string } } | null;
  noSignal: { key: TranslationKey; params: Record<string, number> } | null;
  focus: [number, number];
};

export function minutesOf(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

/** `≈ ` in front when a no-signal stretch was counted as a straight line */
export function distanceText(meters: number, approx: boolean, language: Language): string {
  const text = formatDistance(meters, language);
  return approx ? `≈ ${text}` : text;
}

/**
 * A timeline row: stops are numbered like their pins; a gap focuses where the signal came back.
 * `withDate` (the window spans more than one Bangkok day) puts the day before each time: `25 พ.ย. 01:10`.
 */
export function timelineView(item: RouteTimelineItem, language: Language, withDate = false): TimelineView {
  const clock = (iso: string) =>
    withDate ? `${formatDayMonth(iso, language)} ${formatTime(iso, language)}` : formatTime(iso, language);
  if (item.kind === 'stop') {
    const first = item.index === 1;
    return {
      key: `stop-${item.index}`,
      kind: 'stop',
      labelKey: 'tracking.history.stop',
      params: { index: item.index, from: clock(item.startAt), to: clock(item.endAt), minutes: minutesOf(item.seconds) },
      // the route started at the first stop: nothing to measure
      distance:
        first && item.distanceFromPrevM === 0
          ? null
          : {
              key: first ? 'tracking.history.distanceFromStart' : 'tracking.history.distanceFromPrev',
              params: { distance: distanceText(item.distanceFromPrevM, item.distanceFromPrevApprox, language) },
            },
      noSignal:
        item.noSignalSeconds > 0
          ? { key: 'tracking.history.stopNoSignal', params: { minutes: minutesOf(item.noSignalSeconds) } }
          : null,
      focus: [item.lat, item.lng],
    };
  }
  return {
    key: `gap-${item.startAt}`,
    kind: 'gap',
    labelKey: 'tracking.history.gap',
    params: { from: clock(item.startAt), to: clock(item.endAt), minutes: minutesOf(item.seconds) },
    distance: { key: 'tracking.history.gapDistance', params: { distance: distanceText(item.distanceM, true, language) } },
    noSignal: null,
    focus: [item.to.lat, item.to.lng],
  };
}

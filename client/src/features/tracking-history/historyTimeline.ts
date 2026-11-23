import type { TranslationKey } from '@/i18n/locales/th';
import type { Language } from '@/i18n/types';
import { formatTime } from '@/lib/time';
import type { RouteTimelineItem } from './history.api';

export type TimelineView = {
  key: string;
  kind: 'stop' | 'gap';
  labelKey: TranslationKey;
  params: Record<string, string | number>;
  noSignal: { key: TranslationKey; params: Record<string, number> } | null;
  focus: [number, number];
};

export function minutesOf(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

/** A timeline row: stops are numbered like their pins; a gap focuses where the signal came back. */
export function timelineView(item: RouteTimelineItem, language: Language): TimelineView {
  const clock = (iso: string) => formatTime(iso, language);
  if (item.kind === 'stop') {
    return {
      key: `stop-${item.index}`,
      kind: 'stop',
      labelKey: 'tracking.history.stop',
      params: { index: item.index, from: clock(item.startAt), to: clock(item.endAt), minutes: minutesOf(item.seconds) },
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
    noSignal: null,
    focus: [item.to.lat, item.to.lng],
  };
}

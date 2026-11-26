import { bangkokDateOf } from '@/features/tracking-history/historyRange';
import type { Language } from '@/i18n/types';
import { formatDayMonth, formatTime } from '@/lib/time';
import type { RecordingFile } from '../streaming/streaming.api';

/** Include dates when a recording crosses midnight, in both the list and timeline. */
export function recordingClock(file: RecordingFile, language: Language): string {
  const crosses = bangkokDateOf(new Date(file.startAt)) !== bangkokDateOf(new Date(file.endAt));
  const point = (iso: string) =>
    crosses ? `${formatDayMonth(iso, language)} ${formatTime(iso, language)}` : formatTime(iso, language);
  return `${point(file.startAt)}–${point(file.endAt)}`;
}

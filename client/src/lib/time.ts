import type { Language } from '@/i18n/types';

/**
 * All timestamps are stored and sent as UTC and displayed in Asia/Bangkok (blueprint Part 5 §5.1).
 * Bangkok is UTC+7 with no DST, so day bounds are fixed offsets whatever the browser's zone.
 */
export const DISPLAY_TIME_ZONE = 'Asia/Bangkok';

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One locale per UI language. en-GB is day-first and 24-hour, like the Thai display. */
const LOCALE_TAG: Record<Language, string> = { th: 'th-TH', en: 'en-GB' };

const toDate = (value: string | Date): Date => (typeof value === 'string' ? new Date(value) : value);

/** Short date + time in Bangkok, e.g. `5/11/69 00:30` (th) / `05/11/2026, 00:30` (en). */
export function formatDateTime(
  value: string | Date,
  locale: Language,
  options: { seconds?: boolean } = {},
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '';
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    timeZone: DISPLAY_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: options.seconds ? 'medium' : 'short',
  }).format(date);
}

/** 24-hour `HH:mm` in Bangkok. */
export function formatTime(value: string | Date, locale: Language): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    timeZone: DISPLAY_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(toDate(value));
}

/** Day and short month in Bangkok, e.g. `5 พ.ย.` / `5 Nov`. */
export function formatDayMonth(value: string | Date, locale: Language): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    timeZone: DISPLAY_TIME_ZONE,
    day: 'numeric',
    month: 'short',
  }).format(toDate(value));
}

/**
 * UTC ISO instants of 00:00:00.000 and 23:59:59.999 Bangkok time on `dateYmd` (`yyyy-MM-dd`),
 * e.g. `2026-11-04` → `2026-11-03T17:00:00.000Z` .. `2026-11-04T16:59:59.999Z`.
 * Throws RangeError for malformed or impossible dates (no silent roll-over of `2026-02-30`).
 */
export function dayBoundsBangkok(dateYmd: string): { from: string; to: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd);
  if (!match) throw new RangeError(`Invalid date (expected yyyy-MM-dd): ${dateYmd}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utcMidnight = Date.UTC(year, month - 1, day);
  const check = new Date(utcMidnight);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid date: ${dateYmd}`);
  }
  const start = utcMidnight - BANGKOK_OFFSET_MS;
  return {
    from: new Date(start).toISOString(),
    to: new Date(start + DAY_MS - 1).toISOString(),
  };
}

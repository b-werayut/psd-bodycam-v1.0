import { bangkokDateOf, dayWindowOf, shiftDay } from '@/features/tracking-history/historyRange';
import type { TranslationKey } from '@/i18n/locales/th';

/** Selectable days = today back to 29 days before it (Bangkok); the server enforces the same floor. */
export const RECORDING_MAX_DAYS_BACK = 30;
export const PLAYBACK_MAX_RANGE_HOURS = 24;
const FUTURE_SKEW_MS = 5 * 60_000;

export type EvidenceRange = { from: string; to: string };

/** 30 Bangkok `YYYY-MM-DD` dates, today first. */
export function selectableDays(now: Date = new Date()): string[] {
  const today = bangkokDateOf(now);
  return Array.from({ length: RECORDING_MAX_DAYS_BACK }, (_, i) => shiftDay(today, -i));
}

/** 00:00 → 24:00 Bangkok of the day as UTC ISO; today ends at `now`. */
export function dayRange(dateYmd: string, now: Date = new Date()): { from: string; to: string } {
  const window = dayWindowOf(dateYmd);
  return Date.parse(window.to) > now.getTime() ? { from: window.from, to: now.toISOString() } : window;
}

/** A file that crosses midnight is shown (and played) only for the part inside the picked day. */
export function clipToDay(
  file: { startAt: string; endAt: string },
  day: { from: string; to: string },
): { startAt: string; endAt: string } {
  const start = Math.max(Date.parse(file.startAt), Date.parse(day.from));
  const end = Math.min(Date.parse(file.endAt), Date.parse(day.to));
  return {
    startAt: start === Date.parse(file.startAt) ? file.startAt : new Date(start).toISOString(),
    endAt: end === Date.parse(file.endAt) ? file.endAt : new Date(end).toISOString(),
  };
}

/** Percentages on a full 00:00–24:00 Bangkok ruler, independent of today's search cutoff. */
export function recordingDayPosition(
  file: { startAt: string; endAt: string },
  dateYmd: string,
): { left: number; width: number } | null {
  const day = dayWindowOf(dateYmd);
  const origin = Date.parse(day.from);
  const duration = Date.parse(day.to) - origin;
  const start = Math.max(origin, Date.parse(file.startAt));
  const end = Math.min(Date.parse(day.to), Date.parse(file.endAt));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { left: ((start - origin) / duration) * 100, width: ((end - start) / duration) * 100 };
}

export function validateEvidenceRange(range: EvidenceRange, now: Date = new Date()): TranslationKey | null {
  if (!range.from || !range.to) return 'evidence.errorRangeRequired';
  const from = new Date(fromBangkokLocalInput(range.from) || NaN);
  const to = new Date(fromBangkokLocalInput(range.to) || NaN);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 'evidence.errorRangeInvalid';
  if (to.getTime() <= from.getTime()) return 'evidence.errorRangeOrder';
  if (to.getTime() - from.getTime() > PLAYBACK_MAX_RANGE_HOURS * 3_600_000) return 'evidence.errorRangeTooLong';
  if (from.getTime() > now.getTime() + FUTURE_SKEW_MS) return 'evidence.errorRangeFuture';
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const BANGKOK_OFFSET_MS = 7 * 3_600_000;

/** Bangkok wall time with seconds, `YYYY-MM-DDTHH:mm:ss` — the value of `<input type="datetime-local" step="1">`. */
export function bangkokLocalInput(at: Date | string): string {
  const date = typeof at === 'string' ? new Date(at) : at;
  const t = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  return (
    `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}` +
    `T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`
  );
}

/** Bangkok wall time (`YYYY-MM-DDTHH:mm[:ss[.SSS]]`, milliseconds dropped) -> UTC ISO; '' when empty or malformed. */
export function fromBangkokLocalInput(value: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?(?:\.\d{1,3})?$/.exec(value);
  if (!m) return '';
  const at = new Date(`${m[1]}${m[2] ?? ':00'}+07:00`);
  return Number.isNaN(at.getTime()) ? '' : at.toISOString();
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

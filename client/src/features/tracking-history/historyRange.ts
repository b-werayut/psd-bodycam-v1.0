// Route history range = a window of at most 36 h picked as Bangkok date + time (Asia/Bangkok whatever
// the browser zone), a whole Bangkok day by default. The server checks the same rules (400 INVALID_RANGE).

export const HISTORY_PATH = '/tracking/history';
export const HISTORY_MAX_HOURS = 36;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const BANGKOK_OFFSET_MS = 7 * HOUR_MS;

export type HistoryQuery = { deviceId: string | null; from: string; to: string };
/** UTC ISO instants */
export type HistoryWindow = { from: string; to: string };
/** `yyyy-MM-dd` / `HH:mm`, Bangkok wall time */
export type RangeFields = { startDate: string; startTime: string; endDate: string; endTime: string };
export type RangeProblem = 'incomplete' | 'endBeforeStart' | 'tooLong' | 'future';

const pad = (n: number) => String(n).padStart(2, '0');

/** `yyyy-MM-dd` of `date` in Bangkok. */
export function bangkokDateOf(date: Date): string {
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** `HH:mm` of `date` in Bangkok. */
function bangkokTimeOf(date: Date): string {
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** Bangkok `yyyy-MM-dd` + `HH:mm` → UTC ISO; null when malformed or the date does not exist (no roll-over). */
export function bangkokInstant(dateYmd: string, timeHm: string): string | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd);
  const time = /^(\d{2}):(\d{2})$/.exec(timeHm);
  if (!date || !time) return null;
  const [year, month, day, hour, minute] = [date[1], date[2], date[3], time[1], time[2]].map(Number);
  if (hour > 23 || minute > 59) return null;
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day) return null;
  return new Date(wall.getTime() - BANGKOK_OFFSET_MS).toISOString();
}

export function rangeFieldsOf(window: HistoryWindow): RangeFields {
  const from = new Date(window.from);
  const to = new Date(window.to);
  return { startDate: bangkokDateOf(from), startTime: bangkokTimeOf(from), endDate: bangkokDateOf(to), endTime: bangkokTimeOf(to) };
}

export function windowOfFields(fields: RangeFields): HistoryWindow | null {
  const from = bangkokInstant(fields.startDate, fields.startTime);
  const to = bangkokInstant(fields.endDate, fields.endTime);
  return from && to ? { from, to } : null;
}

/** Same rules as the server, checked before loading (a start up to now; the server allows 5 min of skew). */
export function rangeProblem(window: HistoryWindow | null, now: Date = new Date()): RangeProblem | null {
  if (!window) return 'incomplete';
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  if (to <= from) return 'endBeforeStart';
  if (to - from > HISTORY_MAX_HOURS * HOUR_MS) return 'tooLong';
  if (from > now.getTime()) return 'future';
  return null;
}

/** The whole window moved by `days` × 24 h (a 20:00–06:00 shift becomes the same shift of another night). */
export function shiftWindow(window: HistoryWindow, days: number): HistoryWindow {
  const by = days * DAY_MS;
  return {
    from: new Date(Date.parse(window.from) + by).toISOString(),
    to: new Date(Date.parse(window.to) + by).toISOString(),
  };
}

/** The window covers more than one Bangkok day (a whole day ending at 00:00 of the next does not). */
export function spansDays(window: HistoryWindow): boolean {
  return bangkokDateOf(new Date(window.from)) !== bangkokDateOf(new Date(Date.parse(window.to) - 1));
}

function startOfDay(dateYmd: string): number {
  const [y, m, d] = dateYmd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - BANGKOK_OFFSET_MS;
}

/** 00:00 of the day → 00:00 of the next day, Bangkok, as UTC ISO. */
export function dayWindowOf(dateYmd: string): { from: string; to: string } {
  const start = startOfDay(dateYmd);
  return { from: new Date(start).toISOString(), to: new Date(start + DAY_MS).toISOString() };
}

export function shiftDay(dateYmd: string, days: number): string {
  return bangkokDateOf(new Date(startOfDay(dateYmd) + days * DAY_MS));
}

export function isFutureDay(dateYmd: string, now: Date = new Date()): boolean {
  return startOfDay(dateYmd) > now.getTime();
}

/** URL ⇒ query; a missing, broken, longer than HISTORY_MAX_HOURS or future range falls back to today. */
export function parseHistoryQuery(params: URLSearchParams, now: Date = new Date()): HistoryQuery {
  const deviceId = params.get('deviceId')?.trim() || null;
  const from = Date.parse(params.get('from') ?? '');
  const to = Date.parse(params.get('to') ?? '');
  const valid =
    !Number.isNaN(from) && !Number.isNaN(to) && to > from && to - from <= HISTORY_MAX_HOURS * HOUR_MS && from <= now.getTime();
  return valid
    ? { deviceId, from: new Date(from).toISOString(), to: new Date(to).toISOString() }
    : { deviceId, ...dayWindowOf(bangkokDateOf(now)) };
}

export function historySearch(query: HistoryQuery): string {
  const params = new URLSearchParams();
  if (query.deviceId) params.set('deviceId', query.deviceId);
  params.set('from', query.from);
  params.set('to', query.to);
  return params.toString();
}

/** Link to the route history: no times ⇒ today; a work window ⇒ its last HISTORY_MAX_HOURS. */
export function historyHref(input: { deviceId: string; startAt?: string; endAt?: string | null; now?: Date }): string {
  const now = input.now ?? new Date();
  let window = dayWindowOf(bangkokDateOf(now));
  if (input.startAt) {
    const end = input.endAt ? Math.min(Date.parse(input.endAt), now.getTime()) : now.getTime();
    const start = Math.max(Date.parse(input.startAt), end - HISTORY_MAX_HOURS * HOUR_MS);
    window = { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
  }
  return `${HISTORY_PATH}?${historySearch({ deviceId: input.deviceId, ...window })}`;
}

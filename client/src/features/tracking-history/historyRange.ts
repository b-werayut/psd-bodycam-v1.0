// Route history range = one Bangkok day (00:00–24:00 Asia/Bangkok, whatever the browser zone) or a
// window of at most 24 h from a link. The server checks the same rules (400 INVALID_RANGE).

export const HISTORY_PATH = '/tracking/history';
export const HISTORY_MAX_HOURS = 24;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const BANGKOK_OFFSET_MS = 7 * HOUR_MS;

export type HistoryQuery = { deviceId: string | null; from: string; to: string };

const pad = (n: number) => String(n).padStart(2, '0');

/** `yyyy-MM-dd` of `date` in Bangkok. */
export function bangkokDateOf(date: Date): string {
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
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

/** URL ⇒ query; a missing, broken, longer than 24 h or future range falls back to today. */
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

/** Link to the route history: no times ⇒ today; a work window ⇒ its last 24 h. */
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

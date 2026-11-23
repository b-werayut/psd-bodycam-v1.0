import { AppException } from '../../common/errors/app-exception';

export const HISTORY_MAX_RANGE_HOURS = 24;
const FUTURE_SKEW_MS = 5 * 60_000;

/** Route history range: readable ISO dates, end after start, at most 24 h, start not in the future. */
export function parseHistoryRange(fromRaw: string, toRaw: string, now: Date = new Date()): { from: Date; to: Date } {
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  const invalid = (message: string) => new AppException(400, 'INVALID_RANGE', message);
  if (!fromRaw || !toRaw || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw invalid('ช่วงเวลาไม่ถูกต้อง');
  }
  if (to.getTime() <= from.getTime()) throw invalid('เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม');
  const hours = (to.getTime() - from.getTime()) / 3_600_000;
  if (hours > HISTORY_MAX_RANGE_HOURS) {
    throw invalid(`ดูประวัติเส้นทางได้ครั้งละไม่เกิน ${HISTORY_MAX_RANGE_HOURS} ชั่วโมง (ขอมา ${Math.round(hours)} ชั่วโมง)`);
  }
  if (from.getTime() > now.getTime() + FUTURE_SKEW_MS) throw invalid('ดูประวัติของเวลาในอนาคตไม่ได้');
  return { from, to };
}

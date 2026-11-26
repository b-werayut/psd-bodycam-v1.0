import { AppException } from '../../common/errors/app-exception';

export const RECORDING_MAX_DAYS_BACK = 30;
export const PLAYBACK_MAX_RANGE_HOURS = 24;
export const FUTURE_SKEW_MS = 5 * 60_000;

const DAY_MS = 86_400_000;
const BANGKOK_OFFSET_MS = 7 * 3_600_000; // UTC+7, no DST

/** 00:00 Asia/Bangkok of the day (RECORDING_MAX_DAYS_BACK - 1) days before today's Bangkok date. */
export function earliestRecordingFrom(now: Date): Date {
  const bangkokDayStart = Math.floor((now.getTime() + BANGKOK_OFFSET_MS) / DAY_MS) * DAY_MS;
  return new Date(bangkokDayStart - (RECORDING_MAX_DAYS_BACK - 1) * DAY_MS - BANGKOK_OFFSET_MS);
}

const invalid = (message: string) => new AppException(400, 'INVALID_RANGE', message);

export function assertRecordingRange(from: Date, to: Date, now: Date = new Date()): void {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw invalid('ช่วงเวลาที่ขอดูย้อนหลังไม่ถูกต้อง');
  }
  if (to.getTime() <= from.getTime()) {
    throw invalid('เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม');
  }
  if (to.getTime() - from.getTime() > PLAYBACK_MAX_RANGE_HOURS * 3_600_000) {
    throw invalid(`ขอดูย้อนหลังได้ครั้งละไม่เกิน ${PLAYBACK_MAX_RANGE_HOURS} ชั่วโมง`);
  }
  if (from.getTime() < earliestRecordingFrom(now).getTime()) {
    throw invalid(`ดูย้อนหลังได้ไม่เกิน ${RECORDING_MAX_DAYS_BACK} วัน`);
  }
  if (from.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    throw invalid('ขอดูย้อนหลังของเวลาในอนาคตไม่ได้');
  }
}

/** DSS searches "the last N days up to now", so N must reach back to `from`. */
export function dssDaysBackFor(from: Date, now: Date = new Date()): number {
  const days = Math.ceil((now.getTime() - from.getTime()) / DAY_MS) + 1;
  return Math.max(1, Math.min(RECORDING_MAX_DAYS_BACK, days));
}

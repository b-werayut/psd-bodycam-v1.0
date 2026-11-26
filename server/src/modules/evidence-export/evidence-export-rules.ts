import { AppException } from '../../common/errors/app-exception';
import { FUTURE_SKEW_MS, earliestRecordingFrom } from '../streaming/recording-range';

/** 1 Queued, 2 Processing, 3 Ready, 4 Failed, 5 Expired (frozen: never renumber). */
export const EVIDENCE_EXPORT_STATUS = {
  QUEUED: 1,
  PROCESSING: 2,
  READY: 3,
  FAILED: 4,
  EXPIRED: 5,
} as const;

/** A ready file is kept 24 h after CompletedAt. */
export const EXPORT_TTL_MS = 24 * 3_600_000;

const BANGKOK_OFFSET_MS = 7 * 3_600_000;

const invalid = (message: string) => new AppException(400, 'INVALID_RANGE', message);

/** Range that may be converted to MP4; the cap comes from setting `streaming.download-max-minutes`. */
export function assertExportRange(
  startAt: Date,
  endAt: Date,
  maxMinutes: number,
  now: Date = new Date(),
): void {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw invalid('ช่วงเวลาที่ขอดาวน์โหลดไม่ถูกต้อง');
  }
  if (endAt.getTime() <= startAt.getTime()) {
    throw invalid('เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม');
  }
  const minutes = (endAt.getTime() - startAt.getTime()) / 60_000;
  if (minutes > maxMinutes) {
    throw invalid(
      `ดาวน์โหลดได้ครั้งละไม่เกิน ${maxMinutes} นาที (ขอมา ${Math.ceil(minutes)} นาที) กรุณาแบ่งเป็นหลายช่วง`,
    );
  }
  if (endAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    throw invalid('เวลาสิ้นสุดยังมาไม่ถึง ดาวน์โหลดภาพของเวลาในอนาคตไม่ได้');
  }
  if (startAt.getTime() < earliestRecordingFrom(now).getTime()) {
    throw invalid('ดาวน์โหลดภาพย้อนหลังได้ไม่เกิน 30 วัน');
  }
}

/** Same range again returns the existing row while queued / processing, or ready and not expired. */
export function isReusableExport(
  row: { Status: number; ExpiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (row.Status === EVIDENCE_EXPORT_STATUS.QUEUED) return true;
  if (row.Status === EVIDENCE_EXPORT_STATUS.PROCESSING) return true;
  return (
    row.Status === EVIDENCE_EXPORT_STATUS.READY &&
    row.ExpiresAt !== null &&
    row.ExpiresAt.getTime() > now.getTime()
  );
}

/** ASCII only (avoids RFC 5987 pitfalls in Content-Disposition): evidence_{code}_{YYYYMMDD-HHmmss Bangkok}.mp4 */
export function exportFileName(input: { deviceCode: string; startAt: Date }): string {
  const code = input.deviceCode.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const iso = new Date(input.startAt.getTime() + BANGKOK_OFFSET_MS).toISOString(); // 2026-11-25T17:06:30.000Z
  const stamp = `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
  return `${['evidence', code, stamp].filter(Boolean).join('_')}.mp4`;
}

/** Progress while fetching segments; the last 5% is left for closing the file, checksum and storage. */
export function segmentProgress(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(95, Math.floor((done / total) * 95));
}

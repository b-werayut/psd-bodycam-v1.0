import type { BookingJobSnapshot, CanonicalBookingStatus } from '../booking-integration/mapper/mapper-v1';

/** 6 Planned · 1 Open · 2 Closed · 3 Cancelled (enum numbers are append-only). */
export type WoStatus = 1 | 2 | 3 | 6;

export type JobFacts = { status: CanonicalBookingStatus; checkInAt: Date | null; checkOutAt: Date | null };

/** The FULL target state: the writer applies it verbatim (every "stays as it is" path echoes the current values). */
export type WorkOrderDecision = {
  status: WoStatus;
  /** 1 BookingCheckout, 3 SafetyTimeout (never produced here, only preserved), null when not closed. */
  closeReason: 1 | 3 | null;
  openedAt: Date | null;
  closedAt: Date | null;
  flagChangedAfterClose: boolean;
};

export type CurrentWorkOrder = {
  status: WoStatus;
  closeReason: 1 | 3 | null;
  openedAt: Date | null;
  closedAt: Date | null;
};

/** Checked in and not (yet) checked out again. */
export function isCheckedIn(job: JobFacts): boolean {
  return job.checkInAt !== null && (job.checkOutAt === null || job.checkInAt.getTime() > job.checkOutAt.getTime());
}

/** Design §4.7: the work-order status follows check-in / check-out times (cancel and canonical 4 aside). */
export function decideWorkOrderStatus(current: CurrentWorkOrder | null, job: JobFacts, now: Date): WorkOrderDecision {
  if (job.status === 5) {
    if (current?.status === 2) {
      return {
        status: 2,
        closeReason: current.closeReason,
        openedAt: current.openedAt,
        closedAt: current.closedAt,
        flagChangedAfterClose: true,
      };
    }
    const wasCancelled = current?.status === 3;
    return {
      status: 3,
      closeReason: wasCancelled ? current.closeReason : null,
      openedAt: job.checkInAt ?? current?.openedAt ?? null,
      closedAt: wasCancelled ? (current.closedAt ?? now) : now,
      flagChangedAfterClose: false,
    };
  }

  const closedByTimes =
    job.checkOutAt !== null && (job.checkInAt === null || job.checkInAt.getTime() <= job.checkOutAt.getTime());
  if (closedByTimes || job.status === 4) {
    const stays = current?.status === 2 && job.checkOutAt === null;
    return {
      status: 2,
      closeReason: stays ? (current.closeReason ?? 1) : 1,
      openedAt: job.checkInAt ?? current?.openedAt ?? null,
      closedAt: job.checkOutAt ?? (stays ? current.closedAt : null) ?? now,
      flagChangedAfterClose: false,
    };
  }

  if (isCheckedIn(job)) {
    return { status: 1, closeReason: null, openedAt: job.checkInAt, closedAt: null, flagChangedAfterClose: false };
  }

  return { status: 6, closeReason: null, openedAt: null, closedAt: null, flagChangedAfterClose: false };
}

const BANGKOK_OFFSET_MS = 7 * 3600_000;

/** YYYYMM of the Asia/Bangkok month (UTC+7, no DST). */
export function workOrderPeriod(at: Date): string {
  const d = new Date(at.getTime() + BANGKOK_OFFSET_MS);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatWorkOrderNo(period: string, value: number): string {
  return `WO-${period}-${String(value).padStart(5, '0')}`;
}

export function workOrderTitle(s: Pick<BookingJobSnapshot, 'title' | 'externalJobNo' | 'externalJobId'>): string {
  return s.title ?? s.externalJobNo ?? s.externalJobId;
}

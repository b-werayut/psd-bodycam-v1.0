import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { DrizzleTx } from '../../db/db.types';
import { WorkOrderCounters, WorkOrderEvents, WorkOrders } from '../../db/schema';
import {
  decideWorkOrderStatus,
  formatWorkOrderNo,
  workOrderPeriod,
  type JobFacts,
  type WoStatus,
} from './work-order-rules';

/** What the `BookingJobs` row held before this message (`BookingProjectionService.apply`); null = a new row. */
export type BookingJobPrevious = { plannedStartAt: Date | null; plannedEndAt: Date | null; deviceRefs: string[] };

export type WorkOrderUpsertInput = {
  bookingJobId: bigint;
  title: string;
  teamId: bigint | null;
  leaderUserId: bigint | null;
  job: JobFacts & { plannedStartAt: Date | null; plannedEndAt: Date | null; deviceRefs: string[] };
  previous: BookingJobPrevious | null;
  now: Date;
};

/** What changed, for `workorder:changed` after commit (the caller emits it). */
export type WorkOrderChange = {
  workOrderId: bigint;
  status: WoStatus;
  needsReview: boolean;
  rowVersion: number;
  teamId: bigint | null;
  change: 'created' | 'statusChanged' | 'updated';
};

/** `WorkOrderEvents.EventType` / `Source` and `WorkOrders.ReviewReasons` values written here. */
const EVENT = { CREATED: 1, STATUS_CHANGED: 2 } as const;
const SOURCE_BOOKING = 2;
const REVIEW_BOOKING_CHANGED_AFTER_CLOSE = 1;
const CLOSED: WoStatus = 2;

const STATUS_REASON: Record<WoStatus, string> = {
  1: 'BookingCheckIn',
  2: 'BookingCheckout',
  3: 'BookingCancelled',
  6: 'BookingPlanned',
};

const sameTime = (a: Date | null, b: Date | null) => (a === null || b === null ? a === b : a.getTime() === b.getTime());
const sameList = (a: readonly unknown[] | null, b: readonly unknown[] | null) =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((v, i) => v === (b ?? [])[i]);
const sameSet = (a: readonly string[], b: readonly string[]) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((v) => right.has(v));
};

/** This message's plan times or cameras differ from the row before it (camera order alone is no change). */
const planOrCamerasChanged = (previous: BookingJobPrevious | null, job: WorkOrderUpsertInput['job']) =>
  previous !== null &&
  (!sameTime(previous.plannedStartAt, job.plannedStartAt) ||
    !sameTime(previous.plannedEndAt, job.plannedEndAt) ||
    !sameSet(previous.deviceRefs, job.deviceRefs));

/**
 * The only writer of `WorkOrders` from Booking data (DL33, design §4.7): one work order per `BookingJobs`
 * row, status from check-in / check-out, events in the caller's transaction. Never writes `LastActivityAt`
 * (sessions own it) and never emits — the caller pushes `workorder:changed` after commit.
 */
@Injectable()
export class WorkOrderWriter {
  async upsertFromBooking(tx: DrizzleTx, input: WorkOrderUpsertInput): Promise<WorkOrderChange | null> {
    const [current] = await tx
      .select({
        id: WorkOrders.Id,
        title: WorkOrders.Title,
        status: WorkOrders.Status,
        closeReason: WorkOrders.CloseReason,
        teamId: WorkOrders.TeamId,
        leaderUserId: WorkOrders.LeaderUserId,
        openedAt: WorkOrders.OpenedAt,
        closedAt: WorkOrders.ClosedAt,
        needsReview: WorkOrders.NeedsReview,
        reviewReasons: WorkOrders.ReviewReasons,
      })
      .from(WorkOrders)
      .where(eq(WorkOrders.BookingJobId, input.bookingJobId))
      // NO KEY UPDATE: the key never changes here, and FOR UPDATE would also block the FK inserts that
      // point at this row (events, alerts, later TrackingSessions)
      .for('no key update');

    if (!current) return this.create(tx, input);

    const status = current.status as WoStatus;
    const target = decideWorkOrderStatus(
      { status, closeReason: current.closeReason as 1 | 3 | null, openedAt: current.openedAt, closedAt: current.closedAt },
      input.job,
      input.now,
    );

    // Design §4.7: team / leader against the stored order, plan times / cameras against the row before this
    // message — only while the order is and stays Closed (a reopen never flags).
    const stillClosed = status === CLOSED && target.status === CLOSED;
    const flag =
      stillClosed &&
      (target.flagChangedAfterClose ||
        input.teamId !== current.teamId ||
        input.leaderUserId !== current.leaderUserId ||
        planOrCamerasChanged(input.previous, input.job));
    const reviewReasons =
      flag && !(current.reviewReasons ?? []).includes(REVIEW_BOOKING_CHANGED_AFTER_CLOSE)
        ? [...(current.reviewReasons ?? []), REVIEW_BOOKING_CHANGED_AFTER_CLOSE]
        : current.reviewReasons;
    const needsReview = current.needsReview || flag;

    const unchanged =
      input.title === current.title &&
      target.status === status &&
      target.closeReason === current.closeReason &&
      sameTime(target.openedAt, current.openedAt) &&
      sameTime(target.closedAt, current.closedAt) &&
      input.teamId === current.teamId &&
      input.leaderUserId === current.leaderUserId &&
      needsReview === current.needsReview &&
      sameList(reviewReasons, current.reviewReasons);
    if (unchanged) return null;

    const [updated] = await tx
      .update(WorkOrders)
      .set({
        Title: input.title,
        Status: target.status,
        CloseReason: target.closeReason,
        OpenedAt: target.openedAt,
        ClosedAt: target.closedAt,
        TeamId: input.teamId,
        LeaderUserId: input.leaderUserId,
        NeedsReview: needsReview,
        ReviewReasons: reviewReasons,
        RowVersion: sql`${WorkOrders.RowVersion} + 1`,
        UpdatedAt: sql`now()`,
      })
      .where(eq(WorkOrders.Id, current.id))
      .returning({ rowVersion: WorkOrders.RowVersion });

    const statusChanged = target.status !== status;
    if (statusChanged) {
      await this.event(tx, current.id, input.bookingJobId, EVENT.STATUS_CHANGED, status, target.status);
    }
    return {
      workOrderId: current.id,
      status: target.status,
      needsReview,
      rowVersion: updated.rowVersion,
      teamId: input.teamId,
      change: statusChanged ? 'statusChanged' : 'updated',
    };
  }

  private async create(tx: DrizzleTx, input: WorkOrderUpsertInput): Promise<WorkOrderChange> {
    const target = decideWorkOrderStatus(null, input.job, input.now);
    const period = workOrderPeriod(input.now);
    // the counter row lock serialises numbering within a month until commit (no gaps on rollback)
    const [counter] = await tx
      .insert(WorkOrderCounters)
      .values({ Period: period, LastValue: 1 })
      .onConflictDoUpdate({
        target: WorkOrderCounters.Period,
        set: { LastValue: sql`"WorkOrderCounters"."LastValue" + 1` },
      })
      .returning({ value: WorkOrderCounters.LastValue });

    const [row] = await tx
      .insert(WorkOrders)
      .values({
        WorkOrderNo: formatWorkOrderNo(period, counter.value),
        Title: input.title,
        Status: target.status,
        CloseReason: target.closeReason,
        BookingJobId: input.bookingJobId,
        TeamId: input.teamId,
        LeaderUserId: input.leaderUserId,
        OpenedAt: target.openedAt,
        ClosedAt: target.closedAt,
      })
      .returning({ id: WorkOrders.Id, rowVersion: WorkOrders.RowVersion });

    await this.event(tx, row.id, input.bookingJobId, EVENT.CREATED, null, target.status);
    return {
      workOrderId: row.id,
      status: target.status,
      needsReview: false,
      rowVersion: row.rowVersion,
      teamId: input.teamId,
      change: 'created',
    };
  }

  private async event(
    tx: DrizzleTx,
    workOrderId: bigint,
    bookingJobId: bigint,
    eventType: number,
    from: WoStatus | null,
    to: WoStatus,
  ): Promise<void> {
    await tx.insert(WorkOrderEvents).values({
      WorkOrderId: workOrderId,
      EventType: eventType,
      FromStatus: from,
      ToStatus: to,
      Source: SOURCE_BOOKING,
      BookingJobId: bookingJobId,
      Reason: eventType === EVENT.STATUS_CHANGED ? STATUS_REASON[to] : null,
    });
  }
}

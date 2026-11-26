import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../../db/db.constants';
import type { DrizzleDB, DrizzleTx } from '../../../db/db.types';
import { IntegrationInbox, WorkOrders } from '../../../db/schema';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { emitWorkOrderChanged } from '../../work-orders/work-order-events';
import { workOrderTitle, type WoStatus } from '../../work-orders/work-order-rules';
import { WorkOrderWriter, type WorkOrderChange } from '../../work-orders/work-order-writer.service';
import { validateInboundBody } from '../inbound/inbound-body';
import { BOOKING_SOURCE, safeErrorSummary } from '../inbound/inbound-call-log.service';
import { mapV1 } from '../mapper/mapper-v1';
import { BookingProjectionService } from '../projection/booking-projection.service';

export type InboxOutcome = 'processed' | 'ignored' | 'failed' | 'dead' | 'skipped';

/** `IntegrationInbox.Status` (Part 4 §4.4). */
const INBOX = { PENDING: 1, PROCESSED: 2, FAILED: 3, IGNORED: 4, DEAD: 5 } as const;

/** Failed attempts before a row is `Dead` (Part 7 / Part 2 §2.6 for this queue — not the general 5). */
export const INBOX_MAX_ATTEMPTS = 10;

/** A stored body that contract v1 rejects. The message lists fields and issues only, never values. */
export class InboxPayloadInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InboxPayloadInvalidError';
  }
}

type Committed =
  | { kind: 'skipped' }
  | { kind: 'ignored' }
  | { kind: 'processed'; bookingJobId: bigint; change: WorkOrderChange | null };

/**
 * Worker role `integration` (design §4.4): one inbox row ⇒ one transaction (projection + team / leader +
 * work order + events), `workorder:changed` only after commit. A row that throws is rolled back as a whole
 * and counted in a new transaction: `Failed`, then `Dead` at the 10th failure.
 */
@Injectable()
export class BookingInboxProcessor {
  private readonly logger = new Logger(BookingInboxProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly projection: BookingProjectionService,
    private readonly writer: WorkOrderWriter,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** `skipped` = not Pending / Failed any more, or another worker holds the row right now. */
  async process(inboxId: bigint, now: Date = new Date()): Promise<InboxOutcome> {
    let committed: Committed;
    try {
      committed = await this.db.transaction((tx) => this.processLocked(tx, inboxId, now));
    } catch (err) {
      return this.recordFailure(inboxId, err);
    }
    if (committed.kind === 'processed') await this.emitAfterCommit(committed.bookingJobId, committed.change);
    return committed.kind;
  }

  private async processLocked(tx: DrizzleTx, inboxId: bigint, now: Date): Promise<Committed> {
    const [row] = await tx
      .select({ payload: IntegrationInbox.Payload })
      .from(IntegrationInbox)
      .where(
        and(
          eq(IntegrationInbox.Id, inboxId),
          eq(IntegrationInbox.Source, BOOKING_SOURCE),
          inArray(IntegrationInbox.Status, [INBOX.PENDING, INBOX.FAILED]),
        ),
      )
      .for('update', { skipLocked: true });
    if (!row) return { kind: 'skipped' };

    // The api stores the body as received and validated a copy whose free text it cut to the column sizes:
    // the same validation here yields that same envelope (an uncut title would fail every attempt).
    const checked = validateInboundBody(row.payload);
    if (!checked.ok) {
      throw new InboxPayloadInvalidError(checked.details.map((d) => `${d.field}: ${d.issue}`).join('; '));
    }
    const snapshot = mapV1(checked.value);

    // Lock order: BookingJobs → Teams → TeamMembers (apply) → WorkOrders → WorkOrderCounters (writer).
    // The writer's create path relies on the BookingJobs row lock apply holds until commit.
    const projected = await this.projection.apply(tx, snapshot);
    if (projected.kind === 'ignored') {
      await this.finish(tx, inboxId, INBOX.IGNORED);
      return { kind: 'ignored' };
    }

    const change = await this.writer.upsertFromBooking(tx, {
      bookingJobId: projected.bookingJobId,
      title: workOrderTitle(snapshot),
      teamId: projected.teamId,
      leaderUserId: projected.leaderUserId,
      job: {
        status: snapshot.status,
        checkInAt: snapshot.checkInAt,
        checkOutAt: snapshot.checkOutAt,
        plannedStartAt: snapshot.plannedStartAt,
        plannedEndAt: snapshot.plannedEndAt,
        deviceRefs: snapshot.deviceRefs,
      },
      previous: projected.previous,
      now,
    });
    await this.finish(tx, inboxId, INBOX.PROCESSED);
    return { kind: 'processed', bookingJobId: projected.bookingJobId, change };
  }

  private async finish(tx: DrizzleTx, inboxId: bigint, status: number): Promise<void> {
    await tx
      .update(IntegrationInbox)
      .set({ Status: status, ProcessedAt: sql`now()` })
      .where(eq(IntegrationInbox.Id, inboxId));
  }

  /**
   * After the rollback, in its own statement (= a new transaction). Only a row still Pending / Failed is
   * counted: if another worker finished it meanwhile, its result stands. A DB that cannot take even this
   * update rethrows, so the queue job fails and the row stays for the retry sweep.
   */
  private async recordFailure(inboxId: bigint, err: unknown): Promise<InboxOutcome> {
    // never the payload: drizzle query errors carry the SQL params in their message (safeErrorSummary)
    const summary = safeErrorSummary(err);
    let counted: { status: number; attempts: number } | undefined;
    try {
      [counted] = await this.db
        .update(IntegrationInbox)
        .set({
          Attempts: sql`${IntegrationInbox.Attempts} + 1`,
          Status: sql`case when ${IntegrationInbox.Attempts} + 1 >= ${sql.raw(String(INBOX_MAX_ATTEMPTS))}
            then ${sql.raw(String(INBOX.DEAD))} else ${sql.raw(String(INBOX.FAILED))} end`,
          LastError: summary,
        })
        .where(
          and(eq(IntegrationInbox.Id, inboxId), inArray(IntegrationInbox.Status, [INBOX.PENDING, INBOX.FAILED])),
        )
        .returning({ status: IntegrationInbox.Status, attempts: IntegrationInbox.Attempts });
    } catch (writeErr) {
      this.logger.error(
        `Processing inbox ${inboxId} failed (${summary}) and the result could not be saved: ${safeErrorSummary(writeErr)}`,
      );
      throw err;
    }

    if (!counted) return 'skipped';
    if (counted.status === INBOX.DEAD) {
      this.logger.error(`inbox ${inboxId} is Dead after ${counted.attempts} failed attempts: ${summary}`);
      return 'dead';
    }
    this.logger.warn(`Processing inbox ${inboxId} failed (attempt ${counted.attempts}): ${summary}`);
    return 'failed';
  }

  /**
   * The writer's change, or — when only booking fields / cameras changed (writer: null) — the order as it is
   * now, as `updated`, so the work-order list refreshes them too. Never fails the processed row.
   */
  private async emitAfterCommit(bookingJobId: bigint, change: WorkOrderChange | null): Promise<void> {
    try {
      const pushed = change ?? (await this.currentAsUpdated(bookingJobId));
      if (pushed) emitWorkOrderChanged(this.realtime, pushed);
    } catch (err) {
      this.logger.warn(`Failed to push workorder:changed for BookingJobs ${bookingJobId}: ${safeErrorSummary(err)}`);
    }
  }

  private async currentAsUpdated(bookingJobId: bigint): Promise<WorkOrderChange | null> {
    const [wo] = await this.db
      .select({
        id: WorkOrders.Id,
        status: WorkOrders.Status,
        needsReview: WorkOrders.NeedsReview,
        rowVersion: WorkOrders.RowVersion,
        teamId: WorkOrders.TeamId,
      })
      .from(WorkOrders)
      .where(eq(WorkOrders.BookingJobId, bookingJobId));
    if (!wo) return null;
    return {
      workOrderId: wo.id,
      status: wo.status as WoStatus,
      needsReview: wo.needsReview,
      rowVersion: wo.rowVersion,
      teamId: wo.teamId,
      change: 'updated',
    };
  }
}

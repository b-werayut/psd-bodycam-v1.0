import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { DrizzleTx } from '../../../db/db.types';
import { BookingJobs, Users } from '../../../db/schema';
import { resolveDeviceRefs } from '../../devices/device-refs';
import type { BookingJobPrevious } from '../../work-orders/work-order-writer.service';
import { isCheckedIn } from '../../work-orders/work-order-rules';
import type { BookingJobSnapshot } from '../mapper/mapper-v1';
import { findTeamIdByRef, moveLeader, upsertTeamByRef } from './booking-teams';

export type ProjectionResult =
  | { kind: 'ignored' }
  | {
      kind: 'applied';
      bookingJobId: bigint;
      teamId: bigint | null;
      leaderUserId: bigint | null;
      /** The row before this message (for `WorkOrderWriter`'s after-close check); null = a new row. */
      previous: BookingJobPrevious | null;
    };

/** `BookingJobs.MappingIssues` this projection computes (1, 4 and 6 are not produced here). */
const ISSUE = { UNKNOWN_LEADER_REF: 2, UNMAPPED_STATUS: 3, UNKNOWN_DEVICE_REF: 5 } as const;

const SOURCE_SYSTEM = 'BOOKING';

/**
 * Version guard of the upsert (design §4.5, Part 7 §7.5.2): `updatedAt` on both sides ⇒ compare it;
 * otherwise numeric `version` on both sides ⇒ compare that (the column is text: '10' > '9' only as numbers);
 * nothing comparable ⇒ the latest message wins. Equal ⇒ applied again (same message reprocessed).
 */
const NOT_OLDER = sql`case
  when excluded."ExternalUpdatedAt" is not null and "BookingJobs"."ExternalUpdatedAt" is not null
    then excluded."ExternalUpdatedAt" >= "BookingJobs"."ExternalUpdatedAt"
  when excluded."ExternalVersion" ~ '^[0-9]+$' and "BookingJobs"."ExternalVersion" ~ '^[0-9]+$'
    then excluded."ExternalVersion"::numeric >= "BookingJobs"."ExternalVersion"::numeric
  else true
end`;

/**
 * Projects one Booking job into `BookingJobs` (+ its team and team leader) inside the caller's transaction.
 * An older message touches nothing — no row, no team, no leader. The work order is the caller's next step
 * (`WorkOrderWriter.upsertFromBooking`, same transaction).
 */
@Injectable()
export class BookingProjectionService {
  async apply(tx: DrizzleTx, s: BookingJobSnapshot): Promise<ProjectionResult> {
    // The row as it is before this message — the same row the upsert below locks anyway (NO KEY UPDATE: the
    // key never changes, and WorkOrders / events / alerts reference it through FKs).
    const [existing] = await tx
      .select({
        plannedStartAt: BookingJobs.PlannedStartAt,
        plannedEndAt: BookingJobs.PlannedEndAt,
        deviceRefs: BookingJobs.DeviceRefs,
      })
      .from(BookingJobs)
      .where(and(eq(BookingJobs.SourceSystem, SOURCE_SYSTEM), eq(BookingJobs.ExternalJobId, s.externalJobId)))
      .for('no key update');
    const previous: BookingJobPrevious | null = existing
      ? { plannedStartAt: existing.plannedStartAt, plannedEndAt: existing.plannedEndAt, deviceRefs: existing.deviceRefs ?? [] }
      : null;

    // read-only lookups first: the guard below decides whether anything is written at all
    const leaderUserId = s.leaderRef === null ? null : await this.userIdByBookingRef(tx, s.leaderRef);
    const devices = await resolveDeviceRefs(tx, s.deviceRefs);
    const knownTeamId = s.teamRef === null ? null : await findTeamIdByRef(tx, s.teamRef);

    const issues: number[] = [];
    if (s.leaderRef !== null && leaderUserId === null) issues.push(ISSUE.UNKNOWN_LEADER_REF);
    if (s.status === 9) issues.push(ISSUE.UNMAPPED_STATUS);
    if (s.deviceRefs.some((ref) => !devices.has(ref))) issues.push(ISSUE.UNKNOWN_DEVICE_REF);

    const values = {
      ExternalJobNo: s.externalJobNo,
      DoNo: s.doNo,
      ShNo: s.shNo,
      ExternalVersion: s.externalVersion,
      ExternalUpdatedAt: s.externalUpdatedAt,
      Status: s.status,
      RawStatus: s.rawStatus,
      Title: s.title,
      BookingTeamRef: s.teamRef,
      TeamId: knownTeamId,
      BookingLeaderRef: s.leaderRef,
      LeaderUserId: leaderUserId,
      ScheduledDate: s.scheduledDate,
      PlannedStartAt: s.plannedStartAt,
      PlannedEndAt: s.plannedEndAt,
      BookingCheckInAt: s.checkInAt,
      BookingCheckOutAt: s.checkOutAt,
      DeviceRefs: s.deviceRefs,
      SiteName: s.siteName,
      SiteAddress: s.siteAddress,
      SiteLat: s.siteLat,
      SiteLng: s.siteLng,
      Raw: s.raw,
      PayloadHash: s.payloadHash,
      MappingIssues: issues.length ? issues : null,
    };

    const [row] = await tx
      .insert(BookingJobs)
      .values({ SourceSystem: SOURCE_SYSTEM, ExternalJobId: s.externalJobId, ...values })
      .onConflictDoUpdate({
        target: [BookingJobs.SourceSystem, BookingJobs.ExternalJobId],
        set: { ...values, LastSyncedAt: sql`now()`, SourceMissingSince: null },
        setWhere: NOT_OLDER,
      })
      .returning({ id: BookingJobs.Id });
    if (!row) return { kind: 'ignored' };

    let teamId = knownTeamId;
    if (s.teamRef !== null && teamId === null) {
      teamId = await upsertTeamByRef(tx, s.teamRef);
      await tx.update(BookingJobs).set({ TeamId: teamId }).where(eq(BookingJobs.Id, row.id));
    }

    // Q55: the team leader follows the job only while it is worked on (checked in, not closed / cancelled);
    // the job's own LeaderUserId always follows leaderRef (above)
    const workedOn = isCheckedIn(s) && s.status !== 4 && s.status !== 5;
    if (workedOn && teamId !== null && leaderUserId !== null) await moveLeader(tx, teamId, leaderUserId);

    return { kind: 'applied', bookingJobId: row.id, teamId, leaderUserId, previous };
  }

  private async userIdByBookingRef(tx: DrizzleTx, ref: string): Promise<bigint | null> {
    const [user] = await tx
      .select({ id: Users.Id })
      .from(Users)
      .where(and(eq(Users.BookingEmployeeRef, ref), eq(Users.IsDeleted, false)));
    return user?.id ?? null;
  }
}

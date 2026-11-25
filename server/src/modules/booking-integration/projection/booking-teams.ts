import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { DrizzleTx } from '../../../db/db.types';
import { TeamMembers, Teams } from '../../../db/schema';

/** `TeamMembers.Role`: 1 Leader · 2 Member. */
const LEADER = 1;

/** The live team created for `teamRef`, or null. */
export async function findTeamIdByRef(tx: DrizzleTx, teamRef: string): Promise<bigint | null> {
  const [row] = await tx
    .select({ id: Teams.Id })
    .from(Teams)
    .where(and(eq(Teams.BookingTeamRef, teamRef), eq(Teams.IsDeleted, false)));
  return row?.id ?? null;
}

/**
 * The team of `teamRef`, created on first sight (`Code` = `Name` = `BookingTeamRef` = `teamRef` — design §4.6,
 * DL53). `UQ_Teams_BookingRef` makes a concurrent first sight wait, then read the winner's row.
 */
export async function upsertTeamByRef(tx: DrizzleTx, teamRef: string): Promise<bigint> {
  const existing = await findTeamIdByRef(tx, teamRef);
  if (existing !== null) return existing;

  const [inserted] = await tx
    .insert(Teams)
    .values({ Code: teamRef, Name: teamRef, BookingTeamRef: teamRef })
    .onConflictDoNothing({
      target: Teams.BookingTeamRef,
      where: sql`"BookingTeamRef" is not null and "IsDeleted" = false`,
    })
    .returning({ id: Teams.Id });
  if (inserted) return inserted.id;

  const raced = await findTeamIdByRef(tx, teamRef);
  if (raced === null) throw new Error(`upsertTeamByRef: team ${teamRef} vanished after a conflict`);
  return raced;
}

/**
 * Makes `userId` the active leader of `teamId` (design §4.6; the caller decides when — Q55). Closes the
 * team's current leader row and every other active membership of the user (`UQ_TeamMembers_ActiveUser`)
 * before it opens the new row, so the partial uniques and `EX_TeamMembers_LeaderNoOverlap` hold at every
 * statement. Already the active leader ⇒ nothing changes, false.
 */
export async function moveLeader(tx: DrizzleTx, teamId: bigint, userId: bigint): Promise<boolean> {
  // One leader change per team at a time (two messages of the same team racing). NO KEY UPDATE, not
  // UPDATE: every BookingJobs / WorkOrders row written with this TeamId holds FOR KEY SHARE on the team
  // through the FK, and FOR UPDATE would wait on those (two new jobs of one team ⇒ deadlock).
  const [team] = await tx.select({ id: Teams.Id }).from(Teams).where(eq(Teams.Id, teamId)).for('no key update');
  if (!team) throw new Error(`moveLeader: team ${teamId} not found`);

  // Id order: two moves that close each other's rows lock them in the same order (no deadlock)
  const active = await tx
    .select({ id: TeamMembers.Id, teamId: TeamMembers.TeamId, userId: TeamMembers.UserId, role: TeamMembers.Role })
    .from(TeamMembers)
    .where(
      and(
        isNull(TeamMembers.ValidTo),
        or(and(eq(TeamMembers.TeamId, teamId), eq(TeamMembers.Role, LEADER)), eq(TeamMembers.UserId, userId)),
      ),
    )
    .orderBy(asc(TeamMembers.Id))
    .for('update');
  if (active.some((r) => r.teamId === teamId && r.role === LEADER && r.userId === userId)) return false;

  // clock_timestamp(), read after the locks: a row the previous lock holder just committed may carry a
  // ValidFrom later than this transaction's now(), and CK_TeamMembers_Window needs ValidTo > ValidFrom.
  // Kept as text (microseconds) so the closed rows and the new row share the exact same instant.
  const [clock] = await tx.execute<{ at: string }>(sql`select clock_timestamp()::text as at`);
  const at = sql`${clock.at}::timestamptz`;

  if (active.length) {
    await tx
      .update(TeamMembers)
      .set({ ValidTo: at })
      .where(inArray(TeamMembers.Id, active.map((r) => r.id)));
  }
  await tx.insert(TeamMembers).values({ TeamId: teamId, UserId: userId, Role: LEADER, ValidFrom: at, AssignedBy: null });
  return true;
}

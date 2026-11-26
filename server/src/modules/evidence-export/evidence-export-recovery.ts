import { and, eq, lt } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/db.types';
import { EvidenceExports } from '../../db/schema';
import { EVIDENCE_EXPORT_STATUS } from './evidence-export-rules';

export const STUCK_EXPORT_MESSAGE = 'งานค้าง กรุณาสั่งใหม่';

/**
 * A Processing row started before `cutoff` can never finish (its worker died): Failed, the user asks again.
 * Guarded by `Status = Processing`, so a row that finishes meanwhile is not overwritten. Returns the ids.
 */
export async function failStuckProcessing(db: DrizzleDB, cutoff: Date): Promise<bigint[]> {
  const rows = await db
    .update(EvidenceExports)
    .set({ Status: EVIDENCE_EXPORT_STATUS.FAILED, ErrorMessage: STUCK_EXPORT_MESSAGE, CompletedAt: new Date() })
    .where(and(eq(EvidenceExports.Status, EVIDENCE_EXPORT_STATUS.PROCESSING), lt(EvidenceExports.StartedAt, cutoff)))
    .returning({ id: EvidenceExports.Id });
  return rows.map((r) => r.id);
}

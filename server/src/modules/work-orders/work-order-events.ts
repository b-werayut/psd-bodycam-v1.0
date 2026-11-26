import { Logger } from '@nestjs/common';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import { TRACKING_ROOM } from '../realtime/realtime-rooms';
import type { WorkOrderChange } from './work-order-writer.service';

export const WORKORDER_CHANGED = 'workorder:changed';

export type WorkOrderChangedEvent = {
  workOrderId: string;
  status: WorkOrderChange['status'];
  needsReview: boolean;
  rowVersion: number;
  change: WorkOrderChange['change'];
};

const logger = new Logger('WorkOrderEvents');

/**
 * Pushes `workorder:changed` (design §4.7) to `tracking` and, when the order has a team, `team:{teamId}`.
 * Call only after the transaction that made the change has committed. The two rooms have disjoint
 * audiences (a TEAM_LEADER never joins `tracking`, web users never join `team:*`), so two emits never
 * deliver twice to one socket. Never throws: a lost push only delays a screen until its next refetch.
 */
export function emitWorkOrderChanged(realtime: RealtimeGateway, c: WorkOrderChange): void {
  try {
    const bus = realtime.bus;
    if (!bus) return;
    const payload: WorkOrderChangedEvent = {
      workOrderId: String(c.workOrderId),
      status: c.status,
      needsReview: c.needsReview,
      rowVersion: c.rowVersion,
      change: c.change,
    };
    bus.to(TRACKING_ROOM).emit(WORKORDER_CHANGED, payload);
    if (c.teamId !== null) bus.to(`team:${c.teamId}`).emit(WORKORDER_CHANGED, payload);
  } catch (err) {
    logger.warn(`Failed to push ${WORKORDER_CHANGED} for work order ${c.workOrderId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

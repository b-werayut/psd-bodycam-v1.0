import type { ResolvedDevice } from '../devices/device-refs';
import type { DisplayStatus } from '../devices/device-status-display.service';

/** Real work period: Booking check-in → check-out (or the close time when Booking never sent a check-out). */
export function workWindowOf(
  checkInAt: Date | null,
  checkOutAt: Date | null,
  closedAt: Date | null,
): { from: string; to: string | null } | null {
  if (!checkInAt) return null;
  const to = checkOutAt ?? closedAt;
  return { from: checkInAt.toISOString(), to: to ? to.toISOString() : null };
}

export type WorkOrderCamera = {
  deviceRef: string;
  deviceId: string | null;
  deviceCode: string | null;
  name: string | null;
  platformState: 'online' | 'offline' | 'unknown';
  platformStatusFetchedAt: string | null;
  fromSession: false;
};

/** `DeviceRefs` in the order Booking sent them; a ref that matches no camera shows `deviceId: null` + unknown. */
export function camerasOf(
  deviceRefs: string[] | null,
  resolved: Map<string, ResolvedDevice>,
  statuses: Map<string, DisplayStatus>,
): WorkOrderCamera[] {
  return (deviceRefs ?? []).map((deviceRef) => {
    const device = resolved.get(deviceRef);
    const status = device ? statuses.get(String(device.id)) : undefined;
    return {
      deviceRef,
      deviceId: device ? String(device.id) : null,
      deviceCode: device?.deviceCode ?? null,
      name: device?.name ?? null,
      platformState: status?.platformState ?? 'unknown',
      platformStatusFetchedAt: status?.platformStatusFetchedAt ?? null,
      fromSession: false,
    };
  });
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export type BookingSummary = {
  id: string;
  externalJobNo: string | null;
  doNo: string | null;
  shNo: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  siteName: string | null;
  detail: false;
};

export type BookingFull = {
  id: string;
  sourceSystem: string;
  externalJobId: string;
  externalJobNo: string | null;
  doNo: string | null;
  shNo: string | null;
  status: number;
  rawStatus: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  scheduledDate: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  deviceRefs: string[];
  site: { name: string | null; address: string | null; lat: number | null; lng: number | null };
  lastSyncedAt: string;
  detail: true;
};

/** One joined database row (work order + its job + team + leader). */
export type WorkOrderRecord = {
  id: bigint;
  workOrderNo: string;
  title: string;
  status: number;
  closeReason: number | null;
  needsReview: boolean;
  reviewReasons: number[] | null;
  note: string | null;
  openedAt: Date | null;
  closedAt: Date | null;
  rowVersion: number;
  teamId: bigint | null;
  teamCode: string | null;
  teamName: string | null;
  leaderId: bigint | null;
  leaderFirstName: string | null;
  leaderLastName: string | null;
  jobId: bigint;
  sourceSystem: string;
  externalJobId: string;
  externalJobNo: string | null;
  doNo: string | null;
  shNo: string | null;
  jobStatus: number;
  rawStatus: string | null;
  plannedStartAt: Date | null;
  plannedEndAt: Date | null;
  scheduledDate: string | null;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  deviceRefs: string[] | null;
  siteName: string | null;
  siteAddress: string | null;
  siteLat: number | null;
  siteLng: number | null;
  lastSyncedAt: Date;
};

export function bookingSummaryOf(r: WorkOrderRecord): BookingSummary {
  return {
    id: String(r.jobId),
    externalJobNo: r.externalJobNo,
    doNo: r.doNo,
    shNo: r.shNo,
    plannedStartAt: iso(r.plannedStartAt),
    plannedEndAt: iso(r.plannedEndAt),
    siteName: r.siteName,
    detail: false,
  };
}

export function bookingFullOf(r: WorkOrderRecord): BookingFull {
  return {
    id: String(r.jobId),
    sourceSystem: r.sourceSystem,
    externalJobId: r.externalJobId,
    externalJobNo: r.externalJobNo,
    doNo: r.doNo,
    shNo: r.shNo,
    status: r.jobStatus,
    rawStatus: r.rawStatus,
    plannedStartAt: iso(r.plannedStartAt),
    plannedEndAt: iso(r.plannedEndAt),
    scheduledDate: r.scheduledDate,
    checkInAt: iso(r.checkInAt),
    checkOutAt: iso(r.checkOutAt),
    deviceRefs: r.deviceRefs ?? [],
    site: { name: r.siteName, address: r.siteAddress, lat: r.siteLat, lng: r.siteLng },
    lastSyncedAt: r.lastSyncedAt.toISOString(),
    detail: true,
  };
}

export function toWorkOrderRow(r: WorkOrderRecord, cameras: WorkOrderCamera[]) {
  const leaderName = `${r.leaderFirstName ?? ''} ${r.leaderLastName ?? ''}`.trim();
  return {
    id: String(r.id),
    workOrderNo: r.workOrderNo,
    title: r.title,
    status: r.status,
    needsReview: r.needsReview,
    team: r.teamId !== null ? { id: String(r.teamId), code: r.teamCode, name: r.teamName } : null,
    leader: r.leaderId !== null ? { id: String(r.leaderId), name: leaderName } : null,
    booking: bookingSummaryOf(r),
    workWindow: workWindowOf(r.checkInAt, r.checkOutAt, r.closedAt),
    openedAt: iso(r.openedAt),
    closedAt: iso(r.closedAt),
    // arrives with sessions (P2)
    lastActivityAt: null as string | null,
    cameras,
    rowVersion: r.rowVersion,
  };
}

export type WorkOrderRow = ReturnType<typeof toWorkOrderRow>;

export function toWorkOrderDetail(r: WorkOrderRecord, cameras: WorkOrderCamera[], fullBooking: boolean) {
  const row = toWorkOrderRow(r, cameras);
  return {
    ...row,
    booking: (fullBooking ? bookingFullOf(r) : row.booking) as BookingFull | BookingSummary,
    closeReason: r.closeReason,
    reviewReasons: r.reviewReasons ?? [],
    note: r.note,
    availableActions: [] as string[],
  };
}

export type WorkOrderEventRecord = {
  id: bigint;
  eventType: number;
  fromStatus: number | null;
  toStatus: number | null;
  source: number;
  actorUserId: bigint | null;
  trackingSessionId: bigint | null;
  reason: string | null;
  detail: unknown;
  occurredAt: Date;
};

export function toWorkOrderEvent(e: WorkOrderEventRecord) {
  return {
    id: String(e.id),
    eventType: e.eventType,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    source: e.source,
    actorUserId: e.actorUserId !== null ? String(e.actorUserId) : null,
    trackingSessionId: e.trackingSessionId !== null ? String(e.trackingSessionId) : null,
    reason: e.reason,
    detail: e.detail ?? null,
    occurredAt: e.occurredAt.toISOString(),
  };
}

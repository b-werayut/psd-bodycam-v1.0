import { api } from '@/lib/apiClient';
import type { Paged } from '@/lib/paged';

export type WorkOrderStatus = 1 | 2 | 3 | 6;

export type WorkOrderCamera = {
  deviceRef: string;
  deviceId: string | null;
  deviceCode: string | null;
  name: string | null;
  platformState: 'online' | 'offline' | 'unknown';
  platformStatusFetchedAt: string | null;
  fromSession: false;
};

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

export type WorkOrderRow = {
  id: string;
  workOrderNo: string;
  title: string;
  status: number;
  needsReview: boolean;
  team: { id: string; code: string | null; name: string | null } | null;
  leader: { id: string; name: string } | null;
  booking: BookingSummary;
  workWindow: { from: string; to: string | null } | null;
  openedAt: string | null;
  closedAt: string | null;
  lastActivityAt: string | null;
  cameras: WorkOrderCamera[];
  rowVersion: number;
};

export type WorkOrderDetail = Omit<WorkOrderRow, 'booking'> & {
  booking: BookingFull | BookingSummary;
  closeReason: number | null;
  reviewReasons: number[];
  note: string | null;
  availableActions: string[];
};

export type WorkOrderEvent = {
  id: string;
  eventType: number;
  fromStatus: number | null;
  toStatus: number | null;
  source: number;
  actorUserId: string | null;
  trackingSessionId: string | null;
  reason: string | null;
  detail: unknown;
  occurredAt: string;
};

export type WorkOrderListParams = {
  deviceId?: string;
  status?: WorkOrderStatus;
  q?: string;
  page: number;
  pageSize: number;
};

export const workOrdersApi = {
  list: (params: WorkOrderListParams) =>
    api
      .get<Paged<WorkOrderRow>>('/work-orders', {
        params: {
          ...(params.deviceId ? { deviceId: params.deviceId } : {}),
          ...(params.status ? { status: params.status } : {}),
          ...(params.q ? { q: params.q } : {}),
          page: params.page,
          pageSize: params.pageSize,
        },
      })
      .then((r) => r.data),
  detail: (id: string) => api.get<WorkOrderDetail>(`/work-orders/${id}`).then((r) => r.data),
  events: (id: string) =>
    api.get<{ data: WorkOrderEvent[] }>(`/work-orders/${id}/events`).then((r) => r.data.data),
};

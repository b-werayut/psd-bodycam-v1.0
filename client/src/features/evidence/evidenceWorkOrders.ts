import { workOrdersApi, type WorkOrderRow } from '../work-orders/workOrders.api';

/** Camera filtering happens before server pagination; never download unrelated work orders. */
export async function loadCameraWorkOrders(deviceId: string): Promise<WorkOrderRow[]> {
  const rows: WorkOrderRow[] = [];
  for (let page = 1; ; page += 1) {
    const result = await workOrdersApi.list({ deviceId, page, pageSize: 100 });
    rows.push(...result.data);
    if (!result.data.length || rows.length >= result.total) return rows;
  }
}

/** Actual check-in/check-out period only; planned work has no recorded work period yet. */
export function workOrderDayRange(
  order: Pick<WorkOrderRow, 'workWindow'>,
  day: { from: string; to: string },
): { startAt: string; endAt: string } | null {
  if (!order.workWindow) return null;
  const from = Math.max(Date.parse(order.workWindow.from), Date.parse(day.from));
  const to = Math.min(Date.parse(order.workWindow.to ?? day.to), Date.parse(day.to));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return { startAt: new Date(from).toISOString(), endAt: new Date(to).toISOString() };
}

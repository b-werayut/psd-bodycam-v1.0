import type { StatusTone } from '@/components/command-center';
import type { TranslationKey } from '@/i18n/locales/th';
import type { Language } from '@/i18n/types';
import { formatDateTime } from '@/lib/time';

/** Work order status (blueprint Part 4): 6 Planned, 1 Open, 2 Closed, 3 Cancelled. */
export function workOrderStatusView(status: number): { labelKey: TranslationKey; tone: StatusTone } {
  switch (status) {
    case 1:
      return { labelKey: 'workOrders.status.open', tone: 'success' };
    case 2:
      return { labelKey: 'workOrders.status.closed', tone: 'neutral' };
    case 3:
      return { labelKey: 'workOrders.status.cancelled', tone: 'destructive' };
    default:
      return { labelKey: 'workOrders.status.planned', tone: 'info' };
  }
}

type WindowSource = {
  status: number;
  workWindow: { from: string; to: string | null } | null;
  booking: { plannedStartAt: string | null };
};

/**
 * Real work window if checked in; otherwise the planned start. Only an order that can still start
 * (Planned / Open) says "not started": a Closed (2) or Cancelled (3) one shows just the plan, else "—".
 */
export function workWindowText(
  row: WindowSource,
  language: Language,
): { key: TranslationKey; params: Record<string, string> } {
  if (row.workWindow) {
    const from = formatDateTime(row.workWindow.from, language);
    if (row.workWindow.to === null) return { key: 'workOrders.window.actualOpen', params: { from } };
    return {
      key: 'workOrders.window.actual',
      params: { from, to: formatDateTime(row.workWindow.to, language) },
    };
  }
  const ended = row.status === 2 || row.status === 3;
  if (row.booking.plannedStartAt) {
    return {
      key: ended ? 'workOrders.window.plannedOnly' : 'workOrders.window.planned',
      params: { plan: formatDateTime(row.booking.plannedStartAt, language) },
    };
  }
  return { key: ended ? 'workOrders.window.none' : 'workOrders.window.waiting', params: {} };
}

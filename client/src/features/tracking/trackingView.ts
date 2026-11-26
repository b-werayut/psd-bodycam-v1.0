import { historyHref } from '../tracking-history/historyRange';

/** แผนที่ติดตาม has two views; `?view=` switches them without leaving the current menu (reference tabs). */
export type TrackingView = 'live' | 'history';

export const VIEW_PARAM = 'view';

export function viewOf(params: URLSearchParams, fallback: TrackingView): TrackingView {
  const view = params.get(VIEW_PARAM);
  return view === 'live' || view === 'history' ? view : fallback;
}

/** Today's route of a camera, opened as the history view of แผนที่ติดตาม (the menu highlight stays put). */
export function historyViewHref(deviceId: string, now?: Date): string {
  const query = historyHref({ deviceId, now }).split('?')[1] ?? '';
  return `/tracking?${VIEW_PARAM}=history&${query}`;
}

import { useSearchParams } from 'react-router-dom';

import { usePermission } from '@/lib/usePermission';
import { HistoryPage } from '../tracking-history/HistoryPage';
import { LiveMapPage } from './LiveMapPage';
import { viewOf } from './trackingView';

/**
 * `/tracking` — แผนที่ติดตาม with the reference tabs ตำแหน่งปัจจุบัน | ประวัติเส้นทาง, so a user watching live
 * can flip to a route and back. `?view=history` picks the history tab; without tracking:history it stays live.
 * The ประวัติเส้นทาง menu (`/tracking/history`) is HistoryPage alone, with no tabs.
 */
export function TrackingRoute() {
  const [params] = useSearchParams();
  const canHistory = usePermission('tracking:history');
  return viewOf(params, 'live') === 'history' && canHistory ? <HistoryPage viewSwitch /> : <LiveMapPage />;
}

import { Link } from 'react-router-dom';

import { useLanguage } from '@/i18n/useLanguage';
import { usePermission } from '@/lib/usePermission';
import { cn } from '@/lib/utils';
import { VIEW_PARAM, type TrackingView } from '../trackingView';

/**
 * ตำแหน่งปัจจุบัน ↔ ประวัติเส้นทาง on แผนที่ติดตาม, adapted from Internal-BodyCam's TrackingViewSwitch. The tabs
 * only change `?view=` on `/tracking`, so the sidebar stays on แผนที่ติดตาม (the ประวัติเส้นทาง menu has no tabs).
 * Hidden unless the user can open both views (nothing to switch to).
 */
export function TrackingViewSwitch({ current }: { current: TrackingView }) {
  const { t } = useLanguage();
  const canSwitch = usePermission(['tracking:view', 'tracking:history']);
  if (!canSwitch) return null;

  const items = [
    { key: 'live', label: t('tracking.view.live') },
    { key: 'history', label: t('tracking.view.history') },
  ] as const;

  return (
    <nav aria-label={t('tracking.view.label')} data-slot="tracking-view-switch"
      className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/40 p-1">
      {items.map((item) => (
        <Link
          key={item.key}
          to={`/tracking?${VIEW_PARAM}=${item.key}`}
          aria-current={current === item.key ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-11 items-center justify-center rounded px-2 text-xs font-medium [@media(pointer:fine)]:min-h-8',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            current === item.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

import { Link } from 'react-router-dom';

import { useLanguage } from '@/i18n/useLanguage';
import { usePermission } from '@/lib/usePermission';
import { cn } from '@/lib/utils';

/** Adapted from Internal-BodyCam's tracking navigation. */
export function TrackingViewSwitch() {
  const { t } = useLanguage();
  const canSeeHistory = usePermission('tracking:history');
  if (!canSeeHistory) return null;

  return (
    <nav aria-label={t('tracking.view.label')} className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/40 p-1">
      {[
        { to: '/tracking', label: t('tracking.view.live'), active: true },
        { to: '/tracking/history', label: t('tracking.card.history'), active: false },
      ].map((item) => (
        <Link
          key={item.to} to={item.to} aria-current={item.active ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-11 items-center justify-center rounded px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:fine)]:min-h-8',
            item.active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >{item.label}</Link>
      ))}
    </nav>
  );
}

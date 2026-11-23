import { MapPin, Route, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { DeviceStateBadge } from '@/components/status/DeviceStateBadge';
import { buttonVariants } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';
import { usePermission } from '@/lib/usePermission';
import { formatDateTime } from '@/lib/time';
import type { LiveDevice } from '../liveMerge';
import { positionAge } from '../positionAge';

/** Details of the selected camera on the live map. Live view comes in P4. */
export function CameraCard({ device, now, onClose }: { device: LiveDevice; now: number; onClose: () => void }) {
  const { t, language } = useLanguage();
  const canSeeHistory = usePermission('tracking:history');
  const age = device.lastFixAt ? positionAge(device.lastFixAt, now) : null;

  return (
    <section aria-label={device.deviceCode} className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="nwl-mono truncate text-base font-semibold">{device.deviceCode}</h2>
          {device.name && device.name !== device.deviceCode ? (
            <p className="truncate text-sm text-muted-foreground">{device.name}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('tracking.card.close')}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DeviceStateBadge state={device.platformState} />
        <span className="text-xs text-muted-foreground">
          {device.platformStatusFetchedAt
            ? t('tracking.card.statusAt', { time: formatDateTime(device.platformStatusFetchedAt, language, { seconds: true }) })
            : t('tracking.card.statusFallback')}
        </span>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t('tracking.card.position')}</dt>
          {device.lat !== null && device.lng !== null && age ? (
            <dd className="flex items-start gap-2">
              <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block">{t(age.key, { n: age.n })}</span>
                <span className="nwl-mono block text-xs text-muted-foreground">
                  {device.lat.toFixed(5)}, {device.lng.toFixed(5)}
                </span>
                {device.speedKph !== null ? (
                  <span className="block text-xs text-muted-foreground">
                    {t('tracking.card.speed', { speed: Math.round(device.speedKph) })}
                  </span>
                ) : null}
              </span>
            </dd>
          ) : (
            <dd className="text-muted-foreground">{t('tracking.card.noPosition')}</dd>
          )}
        </div>
      </dl>

      {canSeeHistory ? (
        <Link
          to={`/tracking/history?deviceId=${encodeURIComponent(device.id)}`}
          className={buttonVariants({ variant: 'outline', className: 'mt-4 min-h-11 w-full gap-2' })}
        >
          <Route aria-hidden="true" className="size-4" />
          {t('tracking.card.history')}
        </Link>
      ) : null}
    </section>
  );
}

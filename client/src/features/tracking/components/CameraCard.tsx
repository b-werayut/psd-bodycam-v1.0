import { Camera, Copy, MapPin, Radio, Route, Video, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { DeviceStateBadge } from '@/components/status/DeviceStateBadge';
import { actionToast } from '@/components/ui/action-toast';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';
import { usePermission } from '@/lib/usePermission';
import { cn } from '@/lib/utils';
import type { LiveDevice } from '../liveMerge';
import { isStaleFix, positionAge } from '../positionAge';

/** Adapted from Internal-BodyCam's DeviceTrackingCard. */
export function CameraCard({ device, now, fixActiveSeconds, selected, onSelect, onClose, onWatch }: {
  device: LiveDevice; now: number; fixActiveSeconds: number; selected: boolean; onSelect: () => void; onClose: () => void;
  onWatch?: () => void;
}) {
  const { t } = useLanguage();
  const canSeeHistory = usePermission('tracking:history');
  const canWatch = usePermission('streaming:view-live') && device.platformState === 'online' && onWatch !== undefined;
  const age = device.lastFixAt ? positionAge(device.lastFixAt, now) : null;
  const statusAge = device.platformStatusFetchedAt ? positionAge(device.platformStatusFetchedAt, now) : null;
  const coordinates = device.lat !== null && device.lng !== null
    ? `${device.lat.toFixed(5)}, ${device.lng.toFixed(5)}` : null;
  const gpsLabel = !coordinates ? 'tracking.list.noPosition'
    : isStaleFix(device.lastFixAt, fixActiveSeconds, now) ? 'tracking.state.unknown' : 'tracking.state.online';

  const copyCoordinates = async () => {
    if (!coordinates) return;
    try {
      await navigator.clipboard.writeText(coordinates);
      actionToast.success(t('tracking.card.copySuccess'));
    } catch {
      actionToast.error(t('tracking.card.copyFailed'));
    }
  };

  return (
    <section aria-label={device.deviceCode} className={cn(
      'relative overflow-hidden rounded-lg border border-border bg-card transition-colors motion-reduce:transition-none',
      selected && 'border-primary/50 bg-primary/5 ring-1 ring-inset ring-primary/20',
    )}>
      <button type="button" onClick={onSelect} aria-pressed={selected}
        aria-label={t('tracking.card.viewOnMap', { code: device.deviceCode })}
        className="flex min-h-11 w-full flex-col p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span className={cn('flex w-full items-start justify-between gap-3', selected && 'pr-9')}>
          <span className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Video className="size-4" /></span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold" title={device.name ?? device.deviceCode}>{device.name || device.deviceCode}</span>
              <span className="mt-0.5 block truncate text-xs tabular-nums text-muted-foreground">{t('tracking.card.code', { code: device.deviceCode })}</span>
            </span>
          </span>
          <DeviceStateBadge state={device.platformState} className="shrink-0" />
        </span>
        <span className="mt-3 flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground"><Camera aria-hidden="true" className="size-3.5" />Bodycam</span>
          <span>{t('tracking.card.gps', { status: t(gpsLabel) })}</span>
          {statusAge ? <span>{t('tracking.list.updatedAt', { time: t(statusAge.key, { n: statusAge.n }) })}</span> : null}
        </span>
      </button>
      {selected ? (
        <Button type="button" variant="ghost" size="icon" onClick={onClose}
          aria-label={t('tracking.card.close')} title={t('tracking.card.close')}
          className="absolute right-1 top-1 size-9 [@media(pointer:coarse)]:size-11"><X aria-hidden="true" /></Button>
      ) : null}
      <div className="flex flex-col gap-2.5 border-t border-border/60 px-3 py-2.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            {coordinates ? (
              <span className="inline-flex items-center gap-1.5 font-medium tabular-nums text-foreground"><MapPin aria-hidden="true" className="size-3.5 shrink-0" />{coordinates}</span>
            ) : <span>{t('tracking.card.noPosition')}</span>}
            {age ? <span className="mt-0.5 block">{t('tracking.card.positionAge', { age: t(age.key, { n: age.n }) })}</span> : null}
          </div>
          {coordinates ? (
            <Button type="button" variant="ghost" size="icon" onClick={() => void copyCoordinates()}
              aria-label={t('tracking.card.copyCoordinates')} title={t('tracking.card.copyCoordinates')}
              className="size-9 shrink-0 [@media(pointer:coarse)]:size-11"><Copy aria-hidden="true" /></Button>
          ) : null}
        </div>
        {canWatch || canSeeHistory ? (
          <div className="flex gap-2">
            {canWatch ? (
              <Button type="button" variant="outline" size="sm" className="flex-1 text-xs" onClick={onWatch}>
                <Radio aria-hidden="true" />{t('tracking.card.watch')}
              </Button>
            ) : null}
            {canSeeHistory ? (
              <Button asChild variant="outline" size="sm" className="flex-1 text-xs">
                <Link to={`/tracking/history?deviceId=${encodeURIComponent(device.id)}`}>
                  <Route aria-hidden="true" />{t('tracking.card.history')}
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

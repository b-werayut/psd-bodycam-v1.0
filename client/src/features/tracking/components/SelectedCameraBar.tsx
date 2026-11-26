import { Copy, MapPin, Route, Video, Wifi, X } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

import { DeviceStateBadge } from '@/components/status/DeviceStateBadge';
import { actionToast } from '@/components/ui/action-toast';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';
import { normalizedDeviceName } from '@/lib/deviceName';
import { usePermission } from '@/lib/usePermission';
import type { LiveDevice } from '../liveMerge';
import { isStaleFix, positionAge } from '../positionAge';
import { historyViewHref } from '../trackingView';

interface SelectedCameraBarProps {
  device: LiveDevice;
  now: number;
  fixActiveSeconds: number;
  onWatch: () => void;
  onClose: () => void;
  onHeightChange: (height: number) => void;
}

/** Floats inside the map; reporting its height keeps the selected pin clear of the overlay. */
export function SelectedCameraBar({ device, now, fixActiveSeconds, onWatch, onClose, onHeightChange }: SelectedCameraBarProps) {
  const { t } = useLanguage();
  const ref = useRef<HTMLElement>(null);
  const canWatch = usePermission('streaming:view-live');
  const canHistory = usePermission('tracking:history');
  const coordinates = device.lat !== null && device.lng !== null ? `${device.lat.toFixed(5)}, ${device.lng.toFixed(5)}` : null;
  const gpsKey = !coordinates ? 'tracking.list.noPosition' : isStaleFix(device.lastFixAt, fixActiveSeconds, now) ? 'tracking.state.unknown' : 'tracking.state.online';
  const age = device.lastFixAt ? positionAge(device.lastFixAt, now) : null;

  useLayoutEffect(() => {
    if (!ref.current) return;
    const report = () => onHeightChange(ref.current?.getBoundingClientRect().height ?? 0);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(ref.current);
    return () => { observer.disconnect(); onHeightChange(0); };
  }, [onHeightChange]);

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
    <section ref={ref} aria-label={device.deviceCode} className="pointer-events-auto relative flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-border bg-card p-3 pr-11 shadow-lg lg:p-4 lg:pr-11">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Video aria-hidden="true" className="size-5" /></span>
        <div className="min-w-0">
          <h2 className="max-w-48 truncate text-base font-semibold">{normalizedDeviceName(device.name) ?? device.deviceCode}</h2>
          <p className="text-xs tabular-nums text-muted-foreground">{t('tracking.card.code', { code: device.deviceCode })}</p>
        </div>
      </div>
      <DeviceStateBadge state={device.platformState} />
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"><Wifi aria-hidden="true" className="size-4" />{t('tracking.card.gps', { status: t(gpsKey) })}</span>
      <div className="flex min-w-0 basis-52 grow items-center gap-1">
        <MapPin aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="whitespace-nowrap text-xs font-medium tabular-nums">{coordinates ?? t('tracking.list.noPosition')}</p>
          {age ? <p className="whitespace-nowrap text-xs text-muted-foreground">{t('tracking.card.positionAge', { age: t(age.key, { n: age.n }) })}</p> : null}
        </div>
        {coordinates ? <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label={t('tracking.card.copyCoordinates')} onClick={() => void copyCoordinates()}><Copy aria-hidden="true" /></Button> : null}
      </div>
      {canWatch || canHistory ? <div className="flex flex-wrap items-center gap-2">
        {canWatch ? <Button type="button" size="sm" disabled={device.platformState !== 'online'} onClick={onWatch}><Video aria-hidden="true" />{t('tracking.card.watch')}</Button> : null}
        {canHistory ? <Button asChild variant="outline" size="sm"><Link to={historyViewHref(device.id)}><Route aria-hidden="true" />{t('tracking.card.history')}</Link></Button> : null}
      </div> : null}
      <Button type="button" variant="ghost" size="icon" className="absolute right-1.5 top-1.5 size-8 text-muted-foreground" aria-label={t('tracking.card.close')} onClick={onClose}><X aria-hidden="true" /></Button>
    </section>
  );
}

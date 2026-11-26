import L from 'leaflet';
import { AlertTriangle, Camera, Clock, Copy, MapPin, Route, Video, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Popup, useMap, useMapEvent } from 'react-leaflet';
import { Link } from 'react-router-dom';

import { DeviceStateBadge } from '@/components/status/DeviceStateBadge';
import { actionToast } from '@/components/ui/action-toast';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';
import { normalizedDeviceName } from '@/lib/deviceName';
import { usePermission } from '@/lib/usePermission';
import type { LiveDevice } from '../liveMerge';
import { historyViewHref } from '../trackingView';
import { isStaleFix, positionAge } from '../positionAge';
import { popupPlacement } from './popupPlacement';

type CameraPopupProps = {
  device: LiveDevice;
  now: number;
  fixActiveSeconds: number;
  onWatch?: () => void;
  onClose: () => void;
  focusRequest?: number;
};

/** What the marker popup shows — adapted from Internal-BodyCam's map device popup (no job / work-area rows). */
export function CameraPopupContent({ device, now, fixActiveSeconds, onWatch, onClose, onLayout }: Omit<CameraPopupProps, 'onClose'> & { onClose?: () => void; onLayout?: () => void }) {
  const { t } = useLanguage();
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!onLayout || !contentRef.current) return;
    onLayout();
    const observer = new ResizeObserver(onLayout);
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [onLayout]);
  const canWatch = usePermission('streaming:view-live') && onWatch !== undefined;
  const canSeeHistory = usePermission('tracking:history');
  const name = normalizedDeviceName(device.name);
  const stale = device.lastFixAt !== null && isStaleFix(device.lastFixAt, fixActiveSeconds, now);
  const age = device.lastFixAt ? positionAge(device.lastFixAt, now) : null;
  const coordinates = device.lat !== null && device.lng !== null ? `${device.lat.toFixed(5)}, ${device.lng.toFixed(5)}` : null;
  const gpsKey = !coordinates ? 'tracking.list.noPosition' : isStaleFix(device.lastFixAt, fixActiveSeconds, now) ? 'tracking.state.unknown' : 'tracking.state.online';
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
    <div ref={contentRef} data-slot="map-device-popup" className="relative flex w-56 max-w-full flex-col gap-2.5 text-sm">
      {onClose ? <Button type="button" variant="ghost" size="icon" className="absolute -right-2 -top-1 size-6 text-muted-foreground"
        aria-label={t('tracking.card.close')} onClick={onClose}><X aria-hidden="true" className="size-3.5" /></Button> : null}
      <div className="flex min-w-0 items-start justify-between gap-3 pr-5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div className="min-w-0">
          {/* div, not p: Leaflet gives every p inside a popup a 17px margin */}
          <div className="truncate font-semibold text-foreground">{name ?? device.deviceCode}</div>
          <div className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">{t('tracking.card.code', { code: device.deviceCode })}</div>
          </div>
        </div>
        <DeviceStateBadge state={device.platformState} className="shrink-0" />
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Camera aria-hidden="true" className="size-3.5 shrink-0" />
        <span>Bodycam</span>
        <span className="ml-auto">{t('tracking.card.gps', { status: t(gpsKey) })}</span>
      </div>
      {coordinates ? (
        <div className="flex items-center gap-1.5 text-xs text-foreground">
          <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="nwl-mono tabular-nums">{coordinates}</span>
          <Button type="button" variant="ghost" size="icon" className="ml-auto size-6 shrink-0 text-muted-foreground"
            aria-label={t('tracking.card.copyCoordinates')} onClick={() => void copyCoordinates()}><Copy aria-hidden="true" className="size-3.5" /></Button>
        </div>
      ) : <div className="text-xs text-muted-foreground">{t('tracking.list.noPosition')}</div>}
      {age ? (
        <div className={stale ? 'flex items-center gap-1.5 text-xs font-medium text-warning-foreground' : 'flex items-center gap-1.5 text-xs text-muted-foreground'}>
          {stale ? <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" /> : <Clock aria-hidden="true" className="size-3.5 shrink-0" />}
          <span>{t('tracking.card.positionAge', { age: t(age.key, { n: age.n }) })}</span>
        </div>
      ) : null}
      <div className="flex flex-col gap-2 border-t border-border pt-2.5">
      {canWatch ? (
        <Button type="button" variant="outline" size="sm" className="w-full text-xs"
          disabled={device.platformState !== 'online'} onClick={onWatch}>
          <Video aria-hidden="true" />{t('tracking.card.watch')}
        </Button>
      ) : null}
      {canSeeHistory ? (
        <Button asChild variant="outline" size="sm" className="w-full text-xs text-primary">
          <Link to={historyViewHref(device.id)} aria-label={t('tracking.popup.viewTodayOf', { code: device.deviceCode })}>
            <Route aria-hidden="true" />{t('tracking.popup.viewToday')}
          </Link>
        </Button>
      ) : null}
      </div>
    </div>
  );
}

/**
 * The popup over a clicked marker. Mount it keyed by device id: react-leaflet re-opens a standalone
 * popup whenever `position` changes, so the position is fixed at mount and live moves go straight to
 * the Leaflet popup — otherwise every `gps:batch` would close and re-open it.
 */
export function CameraPopup(props: CameraPopupProps) {
  const { t } = useLanguage();
  const { onClose } = props;
  const map = useMap();
  const popupRef = useRef<L.Popup | null>(null);
  const [position] = useState<[number, number]>(() => [props.device.lat ?? 0, props.device.lng ?? 0]);
  const { lat, lng } = props.device;

  const syncVisibility = useCallback(() => {
    const popup = popupRef.current;
    const element = popup?.getElement();
    const location = popup?.getLatLng();
    if (!element || !location) return false;
    const anchor = map.latLngToContainerPoint(location);
    const size = map.getSize();
    // The 40 × 48 tracking pin is anchored at [20, 46]. Keep partial pins visible.
    const visible = anchor.x + 20 > 0 && anchor.x - 20 < size.x && anchor.y + 2 > 0 && anchor.y - 46 < size.y;
    element.classList.toggle('tracking-camera-popup--offscreen', !visible);
    element.setAttribute('aria-hidden', String(!visible));
    element.inert = !visible;
    return visible;
  }, [map]);
  const updatePlacement = useCallback(() => {
    const popup = popupRef.current;
    const element = popup?.getElement();
    if (!popup || !element || !syncVisibility()) return;
    const location = popup.getLatLng();
    if (!location) return;
    const size = map.getSize();
    popup.options.autoPan = false;
    popup.options.maxHeight = Math.max(80, size.y - 52);
    popup.update();
    const placement = popupPlacement(map.latLngToContainerPoint(location),
      element.getBoundingClientRect(), { width: size.x, height: size.y });
    popup.options.offset = L.point(placement.offsetX, placement.offsetY);
    element.classList.toggle('tracking-camera-popup--below', placement.side === 'below');
    element.classList.toggle('tracking-camera-popup--overlap', placement.side === 'overlap');
    element.style.setProperty('--tracking-popup-shift-x', `${placement.offsetX}px`);
    popup.update();
  }, [map, syncVisibility]);
  useMapEvent('resize', updatePlacement);
  useMapEvent('move', syncVisibility);
  useMapEvent('moveend', updatePlacement);
  useMapEvent('click', onClose);

  useEffect(() => {
    if (lat !== null && lng !== null) popupRef.current?.setLatLng([lat, lng]);
    updatePlacement();
  }, [lat, lng, props.focusRequest, updatePlacement]);

  return (
    <Popup ref={popupRef} position={position} offset={[0, -60]} className="tracking-camera-popup" closeButton={false} autoPan={false} closeOnClick={false}
      autoPanPaddingTopLeft={[12, 24]} autoPanPaddingBottomRight={[48, 24]} eventHandlers={{ add: updatePlacement, remove: props.onClose }}>
      <section aria-label={t('tracking.popup.label', { code: props.device.deviceCode })}>
        <CameraPopupContent {...props} onLayout={updatePlacement} />
      </section>
    </Popup>
  );
}

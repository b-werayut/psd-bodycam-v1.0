import L from 'leaflet';
import { ListFilter, RotateCw, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import bodycamOffline from '@/assets/markers/bodycam-offline.png';
import bodycamOnline from '@/assets/markers/bodycam-online.png';
import { MapCanvas } from '@/components/map/MapCanvas';
import { MarkerClusterLayer, type ClusterMarker } from '@/components/map/MarkerClusterLayer';
import type { DeviceDisplayState } from '@/components/status/deviceStateTone';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { LiveStreamDialog } from '@/features/streaming/components/LiveStreamDialog';
import { useLanguage } from '@/i18n/useLanguage';
import type { DeviceStateFilterValue } from '@/components/status/DeviceStateFilter';
import { CameraDirectoryPanel } from './components/CameraDirectoryPanel';
import { CameraPopup, CameraPopupContent } from './components/CameraPopup';
import { LiveMapViewport } from './components/LiveMapViewport';
import type { LiveDevice } from './liveMerge';
import { isStaleFix } from './positionAge';
import { useLivePositions } from './useLivePositions';

const iconCache = new Map<string, L.DivIcon>();

/** One shared icon per look, so an unchanged marker keeps its icon object (no DOM swap). */
function markerIcon(state: DeviceDisplayState, stale: boolean, selected: boolean): L.DivIcon {
  const key = `${state}|${stale}|${selected}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const attrs = `data-state="${state}"${stale ? ' data-stale' : ''}${selected ? ' data-selected' : ''}`;
    icon = L.divIcon({
      className: 'tracking-marker-icon',
      html: `<span class="tracking-marker" ${attrs}><img class="tracking-marker__pin" src="${state === 'online' ? bodycamOnline : bodycamOffline}" alt="" /></span>`,
      iconSize: [40, 48],
      iconAnchor: [20, 46],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

/** Re-renders every `ms` so time-based looks (dimmed markers, "x min ago") age without new data. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** แผนที่ติดตาม: every camera's last position, moved live by `gps:batch`. */
export function LiveMapPage() {
  const { t } = useLanguage();
  const { devices, fixActiveSeconds, isPending, isError, refetch } = useLivePositions();
  const [search, setSearch] = useState('');
  const [state, setState] = useState<DeviceStateFilterValue>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [watching, setWatching] = useState<LiveDevice | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [focusSelection, setFocusSelection] = useState(false);
  const selectCamera = useCallback((id: string) => {
    setSelectedId(id);
    setFocusSelection(true);
    setFocusRequest((request) => request + 1);
    const device = devices.find((item) => item.id === id);
    if (device && device.lat !== null && device.lng !== null) setDirectoryOpen(false);
  }, [devices]);
  const selectMarker = useCallback((id: string) => {
    setSelectedId(id);
    setFocusSelection(false);
  }, []);
  // a stopped pipeline sends nothing: markers must still dim as their fix ages (review #7)
  const now = useNow(15_000);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return devices.filter(
      (d) =>
        (state === 'all' || d.platformState === state) &&
        (!term || d.deviceCode.toLowerCase().includes(term) || (d.name ?? '').toLowerCase().includes(term)),
    );
  }, [devices, search, state]);

  const markers = useMemo<ClusterMarker[]>(
    () =>
      filtered.flatMap((d) =>
        d.lat === null || d.lng === null
          ? []
          : [
              {
                id: d.id,
                lat: d.lat,
                lng: d.lng,
                title: d.deviceCode,
                icon: markerIcon(d.platformState, isStaleFix(d.lastFixAt, fixActiveSeconds, now), d.id === selectedId),
                onClick: () => selectMarker(d.id),
              },
            ],
      ),
    [filtered, fixActiveSeconds, selectedId, now, selectMarker],
  );

  const counts = { all: devices.length, online: 0, offline: 0, unknown: 0 };
  for (const device of devices) counts[device.platformState] += 1;
  const selectedDevice = selectedId ? filtered.find((device) => device.id === selectedId) : undefined;
  const hasSelectedPosition = selectedDevice && selectedDevice.lat !== null && selectedDevice.lng !== null;
  const closeSelected = () => setSelectedId((current) => current === selectedDevice?.id ? null : current);
  const directory = (
    <CameraDirectoryPanel devices={filtered} total={devices.length} counts={counts} search={search}
      onSearch={(value) => { setSearch(value); setSelectedId(null); }}
      state={state} onState={(value) => { setState(value); setSelectedId(null); }}
      selectedId={selectedId} onSelect={selectCamera}
      isPending={isPending} unlocatedDetails={selectedDevice && !hasSelectedPosition ? (
        <section aria-label={t('tracking.popup.label', { code: selectedDevice.deviceCode })} className="rounded-lg border border-border bg-card p-3">
          <CameraPopupContent device={selectedDevice} now={now} fixActiveSeconds={fixActiveSeconds}
            onWatch={() => setWatching(selectedDevice)} onClose={closeSelected} />
        </section>
      ) : null} />
  );

  return (
    <>
    <Dialog open={directoryOpen} onOpenChange={setDirectoryOpen}>
      <section aria-label={t('navigation.tracking')} aria-busy={isPending} className="relative isolate flex min-h-0 min-w-0 flex-1 overflow-hidden bg-muted">
        <aside aria-label={t('tracking.list.label')} className="hidden min-h-0 w-80 shrink-0 flex-col overflow-hidden border-r border-border bg-card lg:flex">{directory}</aside>
        <div className="relative isolate min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="absolute inset-0 z-0" aria-label={t('tracking.list.mapTitle')}>
          <MapCanvas zoomControlPosition="topright" className="tracking-live-map">
            <MarkerClusterLayer markers={markers} />
            <LiveMapViewport markers={markers} selectedId={selectedId} focusRequest={focusRequest} focusSelection={focusSelection}
              topPadding={80} />
            {selectedDevice && hasSelectedPosition ? <CameraPopup key={selectedDevice.id} device={selectedDevice}
              now={now} fixActiveSeconds={fixActiveSeconds} focusRequest={focusRequest}
              onWatch={() => setWatching(selectedDevice)} onClose={closeSelected} /> : null}
          </MapCanvas>
        </div>
        <div className="absolute left-3 top-3 z-[500] lg:hidden">
          <DialogTrigger asChild><Button type="button" variant="outline" className="bg-card shadow-sm"><ListFilter aria-hidden="true" />{t('tracking.list.label')}</Button></DialogTrigger>
        </div>
        {isError ? (
          <Alert variant="destructive" className="absolute right-3 top-16 lg:top-4 z-[500] w-[calc(100%-1.5rem)] bg-card sm:max-w-sm">
            <TriangleAlert aria-hidden="true" />
            <div>
              <AlertTitle>{t('tracking.loadFailed')}</AlertTitle>
              <AlertDescription><Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void refetch()}>
                <RotateCw aria-hidden="true" />{t('tracking.retry')}
              </Button></AlertDescription>
            </div>
          </Alert>
        ) : null}
        </div>
      </section>
      <DialogContent closeLabel={t('tracking.list.close')} className="flex h-[80dvh] max-h-[80dvh] flex-col gap-0 overflow-hidden p-0 [&_[data-slot=directory-heading]]:min-h-10 [&_[data-slot=directory-heading]]:items-center [&_[data-slot=directory-heading]]:pr-12">
        <DialogHeader className="sr-only"><DialogTitle>{t('tracking.list.open')}</DialogTitle><DialogDescription>{t('tracking.live.description')}</DialogDescription></DialogHeader>
        {directory}
      </DialogContent>
    </Dialog>
    {watching ? (
      <LiveStreamDialog
        device={{ deviceCode: watching.deviceCode, deviceName: watching.name, onlineStatus: 1 }}
        onClose={() => setWatching(null)}
      />
    ) : null}
    </>
  );
}

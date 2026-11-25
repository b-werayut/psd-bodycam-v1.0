import L from 'leaflet';
import { ListFilter, RotateCw, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import bodycamOffline from '@/assets/markers/bodycam-offline.png';
import bodycamOnline from '@/assets/markers/bodycam-online.png';
import { MapCanvas } from '@/components/map/MapCanvas';
import { MarkerClusterLayer, type ClusterMarker } from '@/components/map/MarkerClusterLayer';
import type { DeviceDisplayState } from '@/components/status/deviceStateTone';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useLanguage } from '@/i18n/useLanguage';
import { CameraListPanel, type StateFilter } from './components/CameraListPanel';
import { LiveMapViewport } from './components/LiveMapViewport';
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
  const [state, setState] = useState<StateFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
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
                onClick: () => setSelectedId(d.id),
              },
            ],
      ),
    [filtered, fixActiveSeconds, selectedId, now],
  );

  const listPanel = (
    <CameraListPanel
      devices={filtered} allDevices={devices} search={search}
      onSearch={(value) => { setSearch(value); setSelectedId(null); }}
      state={state} onState={(value) => { setState(value); setSelectedId(null); }}
      selectedId={selectedId}
      onSelect={(id) => { setSelectedId(id); setMobilePanelOpen(false); }}
      onClearSelection={() => setSelectedId(null)} now={now} fixActiveSeconds={fixActiveSeconds} isPending={isPending}
    />
  );

  return (
    <Dialog open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
      <section aria-labelledby="tracking-page-title" className="relative isolate min-h-0 flex-1 overflow-hidden bg-muted">
        <h1 id="tracking-page-title" className="sr-only">{t('navigation.tracking')}</h1>
        <div className="absolute inset-0 z-0">
          <MapCanvas zoomControlPosition="topright" className="tracking-live-map">
            <MarkerClusterLayer markers={markers} />
            <LiveMapViewport markers={markers} selectedId={selectedId} />
          </MapCanvas>
        </div>
        <aside aria-busy={isPending} className="absolute bottom-5 left-5 top-5 z-[500] hidden w-[380px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm lg:flex">
          {listPanel}
        </aside>
        <div className="absolute inset-x-3 top-3 z-[500] flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-sm lg:hidden">
          <div>
            <p className="text-lg font-semibold">{t('navigation.tracking')}</p>
            <p className="text-xs text-muted-foreground">{t('tracking.list.count', { shown: filtered.length, total: devices.length })}</p>
          </div>
          <DialogTrigger asChild><Button type="button" className="w-full"><ListFilter aria-hidden="true" />{t('tracking.list.open')}</Button></DialogTrigger>
        </div>
        {isError ? (
          <Alert variant="destructive" className="absolute bottom-3 right-3 z-[500] w-[calc(100%-1.5rem)] bg-card lg:max-w-sm">
            <TriangleAlert aria-hidden="true" />
            <div>
              <AlertTitle>{t('tracking.loadFailed')}</AlertTitle>
              <AlertDescription><Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void refetch()}>
                <RotateCw aria-hidden="true" />{t('tracking.retry')}
              </Button></AlertDescription>
            </div>
          </Alert>
        ) : null}
      </section>
      <DialogContent closeLabel={t('tracking.list.close')} className="max-h-[88dvh] overflow-hidden p-0 lg:hidden">
        <DialogHeader className="shrink-0 px-4 pt-4">
          <DialogTitle>{t('tracking.list.label')}</DialogTitle>
          <DialogDescription className="sr-only">{t('tracking.live.description')}</DialogDescription>
        </DialogHeader>
        {listPanel}
      </DialogContent>
    </Dialog>
  );
}

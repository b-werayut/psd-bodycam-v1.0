import L from 'leaflet';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/command-center';
import { MapCanvas } from '@/components/map/MapCanvas';
import { MarkerClusterLayer, type ClusterMarker } from '@/components/map/MarkerClusterLayer';
import type { DeviceDisplayState } from '@/components/status/deviceStateTone';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';
import { CameraCard } from './components/CameraCard';
import { CameraListPanel, type StateFilter } from './components/CameraListPanel';
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
      html: `<span class="tracking-marker" ${attrs}></span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
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

  const selected = devices.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('navigation.tracking')} description={t('tracking.live.description')} />

      {isError ? (
        <Alert variant="destructive" className="mb-3">
          <TriangleAlert aria-hidden="true" />
          <div>
            <AlertTitle>{t('tracking.loadFailed')}</AlertTitle>
            <AlertDescription>
              <Button type="button" variant="outline" size="sm" className="mt-2 gap-2" onClick={() => void refetch()}>
                <RotateCw aria-hidden="true" className="size-4" />
                {t('tracking.retry')}
              </Button>
            </AlertDescription>
          </div>
        </Alert>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="h-[60vh] min-h-[360px] overflow-hidden rounded-xl border border-border lg:h-auto">
          <MapCanvas>
            <MarkerClusterLayer markers={markers} />
          </MapCanvas>
        </div>
        <aside className="flex min-h-0 flex-col gap-4" aria-busy={isPending}>
          {selected ? <CameraCard device={selected} now={now} onClose={() => setSelectedId(null)} /> : null}
          <CameraListPanel
            devices={filtered}
            total={devices.length}
            search={search}
            onSearch={setSearch}
            state={state}
            onState={setState}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </aside>
      </div>
    </div>
  );
}

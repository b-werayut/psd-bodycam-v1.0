import 'leaflet/dist/leaflet.css';
import type { ControlPosition } from 'leaflet';
import { useEffect, useState, type ReactNode } from 'react';
import { MapContainer, TileLayer, ZoomControl, useMap } from 'react-leaflet';

import { useLanguage } from '@/i18n/useLanguage';
import { cn } from '@/lib/utils';
import { MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM, tileLayerConfig } from './mapConfig';

/** Keep Leaflet in sync while a sidebar or panel changes the available map area. */
function SyncMapSize() {
  const map = useMap();
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false, debounceMoveend: true });
    });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/** Base map (react-leaflet) with the configured tile server and a notice when tiles fail to load. */
export function MapCanvas({
  center = MAP_DEFAULT_CENTER,
  zoom = MAP_DEFAULT_ZOOM,
  className,
  zoomControlPosition = 'topleft',
  children,
}: {
  center?: [number, number];
  zoom?: number;
  className?: string;
  zoomControlPosition?: ControlPosition;
  children?: ReactNode;
}) {
  const { t } = useLanguage();
  const [tileFailed, setTileFailed] = useState(false);
  const tiles = tileLayerConfig();

  return (
    <div className={cn('relative isolate h-full min-h-[320px] w-full', className)}>
      <MapContainer center={center} zoom={zoom} className="h-full w-full" zoomControl={false} preferCanvas>
        <SyncMapSize />
        <ZoomControl position={zoomControlPosition} />
        <TileLayer
          url={tiles.url}
          attribution={tiles.attribution}
          eventHandlers={{ tileerror: () => setTileFailed(true), tileload: () => setTileFailed(false) }}
        />
        {children}
      </MapContainer>
      {tileFailed ? (
        <p
          role="status"
          className="pointer-events-none absolute inset-x-3 top-3 z-[500] rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm"
        >
          {t('map.tileError')}
        </p>
      ) : null}
    </div>
  );
}

import 'leaflet/dist/leaflet.css';
import type { ControlPosition } from 'leaflet';
import { useState, type ReactNode } from 'react';
import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet';

import { useLanguage } from '@/i18n/useLanguage';
import { cn } from '@/lib/utils';
import { MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM, tileLayerConfig } from './mapConfig';

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

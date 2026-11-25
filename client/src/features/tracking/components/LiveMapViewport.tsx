import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

import type { ClusterMarker } from '@/components/map/MarkerClusterLayer';

/** Fit the first snapshot and new selections; realtime movement must never reset a user's pan. */
export function LiveMapViewport({ markers, selectedId }: { markers: readonly ClusterMarker[]; selectedId: string | null }) {
  const map = useMap();
  const initialized = useRef(false);
  const previousSelection = useRef<string | null>(null);

  useEffect(() => {
    const selectionChanged = selectedId !== previousSelection.current;
    previousSelection.current = selectedId;
    const selected = selectedId ? markers.find((marker) => marker.id === selectedId) : undefined;
    if (initialized.current && (!selectionChanged || !selected)) return;
    const points = selected ? [selected] : markers;
    if (points.length === 0) return;
    const desktop = window.matchMedia('(min-width: 1024px)').matches;
    map.fitBounds(L.latLngBounds(points.map((point) => [point.lat, point.lng])), {
      paddingTopLeft: desktop ? [420, 48] : [24, 230],
      paddingBottomRight: [48, 48],
      maxZoom: selected ? 15 : 13,
      animate: false,
    });
    initialized.current = true;
  }, [map, markers, selectedId]);

  return null;
}

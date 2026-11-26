import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

import type { ClusterMarker } from '@/components/map/MarkerClusterLayer';

/** Fit the first snapshot and new selections; realtime movement must never reset a user's pan. */
export function LiveMapViewport({ markers, selectedId, focusRequest = 0, focusSelection = true, bottomPadding = 48, topPadding = 48 }: { markers: readonly ClusterMarker[]; selectedId: string | null; focusRequest?: number; focusSelection?: boolean; bottomPadding?: number; topPadding?: number }) {
  const map = useMap();
  const initialized = useRef(false);
  const previousSelection = useRef<string | null>(null);
  const previousFocusRequest = useRef(focusRequest);
  const previousPadding = useRef(bottomPadding);
  const previousTopPadding = useRef(topPadding);

  useEffect(() => {
    const selectionChanged = selectedId !== previousSelection.current;
    previousSelection.current = selectedId;
    const focusRequested = focusRequest !== previousFocusRequest.current;
    previousFocusRequest.current = focusRequest;
    const paddingChanged = previousPadding.current !== bottomPadding;
    previousPadding.current = bottomPadding;
    const topPaddingChanged = previousTopPadding.current !== topPadding;
    previousTopPadding.current = topPadding;
    const selected = focusSelection && selectedId ? markers.find((marker) => marker.id === selectedId) : undefined;
    if (initialized.current && !topPaddingChanged && (!selected || (!selectionChanged && !paddingChanged && !focusRequested))) return;
    const points = selected ? [selected] : markers;
    if (points.length === 0) return;
    map.fitBounds(L.latLngBounds(points.map((point) => [point.lat, point.lng])), {
      paddingTopLeft: [32, topPadding],
      paddingBottomRight: [32, bottomPadding],
      maxZoom: selected ? 15 : 13,
      animate: false,
    });
    initialized.current = true;
  }, [map, markers, selectedId, focusRequest, focusSelection, bottomPadding, topPadding]);

  return null;
}

import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

export type ClusterMarker = {
  id: string;
  lat: number;
  lng: number;
  icon: L.DivIcon;
  /** accessible name of the marker (camera code) */
  title?: string;
  onClick?: () => void;
};

type Entry = L.Marker & { __onClick?: () => void };

/**
 * Brings `group` in line with `next`, keyed by id: kept markers move / change icon in place, gone ones
 * are removed, new ones added — the group is never rebuilt, so open clusters and the view stay put.
 */
export function syncClusterMarkers(
  group: L.MarkerClusterGroup,
  current: ReadonlyMap<string, L.Marker>,
  next: readonly ClusterMarker[],
): Map<string, L.Marker> {
  const out = new Map<string, L.Marker>();
  const added: L.Marker[] = [];
  for (const item of next) {
    const existing = current.get(item.id) as Entry | undefined;
    if (existing) {
      const at = existing.getLatLng();
      if (at.lat !== item.lat || at.lng !== item.lng) existing.setLatLng([item.lat, item.lng]);
      if (existing.options.icon !== item.icon) existing.setIcon(item.icon);
      existing.__onClick = item.onClick;
      out.set(item.id, existing);
      continue;
    }
    const marker = L.marker([item.lat, item.lng], { icon: item.icon, title: item.title, keyboard: true }) as Entry;
    marker.__onClick = item.onClick;
    marker.on('click', () => marker.__onClick?.());
    out.set(item.id, marker);
    added.push(marker);
  }
  const removed = [...current].filter(([id]) => !out.has(id)).map(([, marker]) => marker);
  if (removed.length) group.removeLayers(removed);
  if (added.length) group.addLayers(added);
  return out;
}

/** Clustered markers on the surrounding react-leaflet map. */
export function MarkerClusterLayer({ markers }: { markers: readonly ClusterMarker[] }) {
  const map = useMap();
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  useEffect(() => {
    const group = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 });
    groupRef.current = group;
    map.addLayer(group);
    return () => {
      map.removeLayer(group);
      groupRef.current = null;
      markersRef.current = new Map();
    };
  }, [map]);

  useEffect(() => {
    if (!groupRef.current) return;
    markersRef.current = syncClusterMarkers(groupRef.current, markersRef.current, markers);
  }, [markers]);

  return null;
}

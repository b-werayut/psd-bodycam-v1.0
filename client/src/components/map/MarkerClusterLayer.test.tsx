import L from 'leaflet';
import 'leaflet.markercluster';
import { describe, expect, it, vi } from 'vitest';

import { syncClusterMarkers, type ClusterMarker } from './MarkerClusterLayer';

const icon = L.divIcon({ className: 'x' });
const marker = (id: string, lat: number, extra: Partial<ClusterMarker> = {}): ClusterMarker => ({
  id,
  lat,
  lng: 100.5,
  icon,
  ...extra,
});

describe('syncClusterMarkers', () => {
  it('adds one Leaflet marker per item', () => {
    const group = L.markerClusterGroup();
    const current = syncClusterMarkers(group, new Map(), [marker('a', 13.1), marker('b', 13.2), marker('c', 13.3)]);
    expect(group.getLayers()).toHaveLength(3);
    expect([...current.keys()]).toEqual(['a', 'b', 'c']);
  });

  it('moves kept markers in place, removes gone ones, adds new ones (no full rebuild)', () => {
    const group = L.markerClusterGroup();
    const first = syncClusterMarkers(group, new Map(), [marker('a', 13.1), marker('b', 13.2), marker('c', 13.3)]);
    const keptA = first.get('a');

    const next = syncClusterMarkers(group, first, [marker('a', 13.5), marker('c', 13.3), marker('d', 13.4)]);
    expect([...next.keys()].sort()).toEqual(['a', 'c', 'd']);
    expect(next.get('a')).toBe(keptA);
    expect(next.get('a')?.getLatLng().lat).toBe(13.5);
    expect(group.getLayers()).toHaveLength(3);
    expect(group.hasLayer(first.get('b')!)).toBe(false);
  });

  it('a click calls the item handler', () => {
    const group = L.markerClusterGroup();
    const onClick = vi.fn();
    const current = syncClusterMarkers(group, new Map(), [marker('a', 13.1, { onClick })]);
    current.get('a')!.fire('click');
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

import { render } from '@testing-library/react';
import L from 'leaflet';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClusterMarker } from '@/components/map/MarkerClusterLayer';
import { LiveMapViewport } from './LiveMapViewport';

const map = vi.hoisted(() => ({ fitBounds: vi.fn() }));
vi.mock('react-leaflet', () => ({ useMap: () => map }));

const markers: ClusterMarker[] = [{
  id: '1', lat: 13.8462, lng: 99.92336, title: 'Bodytest', icon: L.divIcon({}),
}];

describe('LiveMapViewport selection requests', () => {
  beforeEach(() => map.fitBounds.mockClear());

  it('focuses the same selected pin again on an explicit request and keeps it above the details', () => {
    const { rerender } = render(<LiveMapViewport markers={markers} selectedId="1" focusRequest={1} bottomPadding={180} />);
    map.fitBounds.mockClear();
    rerender(<LiveMapViewport markers={markers} selectedId="1" focusRequest={2} bottomPadding={180} />);
    expect(map.fitBounds).toHaveBeenCalledOnce();
    const [bounds, options] = map.fitBounds.mock.calls[0];
    expect(bounds.getCenter()).toEqual(L.latLng(13.8462, 99.92336));
    expect(options).toMatchObject({ paddingBottomRight: [32, 180], maxZoom: 15 });
  });

  it('does not reset a manual pan on ordinary realtime position updates', () => {
    const { rerender } = render(<LiveMapViewport markers={markers} selectedId="1" focusRequest={1} />);
    map.fitBounds.mockClear();
    rerender(<LiveMapViewport markers={[{ ...markers[0], lat: 13.85 }]} selectedId="1" focusRequest={1} />);
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it('keeps the existing overview when a different marker is selected without a focus request', () => {
    const overview = [...markers, { ...markers[0], id: '2', lat: 14.2 }];
    const { rerender } = render(<LiveMapViewport markers={overview} selectedId={null} focusSelection={false} />);
    map.fitBounds.mockClear();
    rerender(<LiveMapViewport markers={overview} selectedId="1" focusSelection={false} />);
    rerender(<LiveMapViewport markers={overview} selectedId="2" focusSelection={false} />);
    expect(map.fitBounds).not.toHaveBeenCalled();
    rerender(<LiveMapViewport markers={overview} selectedId="2" focusSelection focusRequest={1} />);
    expect(map.fitBounds).toHaveBeenCalledOnce();
  });
});

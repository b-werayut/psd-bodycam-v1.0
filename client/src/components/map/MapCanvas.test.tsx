import { render } from '@testing-library/react';
import L from 'leaflet';
import { useLayoutEffect } from 'react';
import { useMap } from 'react-leaflet';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/i18n/LanguageProvider';
import { LiveMapViewport } from '@/features/tracking/components/LiveMapViewport';
import { MapCanvas } from './MapCanvas';

function CaptureMap({ onMap }: { onMap: (map: L.Map) => void }) {
  const map = useMap();
  useLayoutEffect(() => onMap(map), [map, onMap]);
  return null;
}

describe('MapCanvas container resizing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fits the first live snapshot before camera markers can be painted', () => {
    let center: L.LatLng | undefined;
    render(
      <LanguageProvider>
        <MapCanvas center={[0, 0]} zoom={4}>
          <LiveMapViewport markers={[{ id: '1', lat: 13.75, lng: 100.5, icon: L.divIcon({}) }]} selectedId={null} />
          <CaptureMap onMap={(map) => { center = map.getCenter(); }} />
        </MapCanvas>
      </LanguageProvider>,
    );
    expect(center?.lat).toBeGreaterThan(13);
    expect(center?.lat).toBeLessThan(14);
    expect(center?.lng).toBeGreaterThan(100);
    expect(center?.lng).toBeLessThan(101);
  });

  it('updates the map viewport and preserves its geographic center when the sidebar changes width', () => {
    let width = 400;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
    const observers = new Set<ResizeObserverCallback>();
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() { observers.add(this.callback); }
      disconnect() { observers.delete(this.callback); }
    });
    let map: L.Map | undefined;
    const { unmount } = render(
      <LanguageProvider>
        <MapCanvas><CaptureMap onMap={(instance) => { map = instance; }} /></MapCanvas>
      </LanguageProvider>,
    );
    const before = map!.getCenter();
    expect(map!.getSize().x).toBe(400);

    width = 600;
    for (const callback of observers) callback([], {} as ResizeObserver);

    expect(map!.getSize().x).toBe(600);
    // Leaflet rounds the pixel origin when the viewport changes.
    expect(map!.project(map!.getCenter()).distanceTo(map!.project(before))).toBeLessThan(1);
    unmount();
    expect(observers.size).toBe(0);
  });
});

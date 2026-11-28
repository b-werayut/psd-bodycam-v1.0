import { render } from '@testing-library/react';
import L from 'leaflet';
import { useLayoutEffect } from 'react';
import { MapContainer, useMap } from 'react-leaflet';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LanguageProvider } from '@/i18n/LanguageProvider';
import type { RouteHistory } from '../history.api';
import { RouteLayers } from './RouteLayers';

const route: RouteHistory = {
  device: { id: '1', code: 'SIM-0001', name: null },
  from: '2026-11-22T17:00:00.000Z',
  to: '2026-11-23T17:00:00.000Z',
  rules: { stopRadiusM: 50, stopMinMinutes: 5, gapSeconds: 150 },
  pointCount: 4,
  suspectCount: 0,
  staleStartCount: 0,
  spikeCount: 0,
  smoothedCount: 0,
  truncated: false,
  start: { lat: 13.75, lng: 100.5, at: '2026-11-23T01:00:00.000Z' },
  end: { lat: 13.8, lng: 100.6, at: '2026-11-23T03:00:00.000Z' },
  totalDistanceM: 13_000,
  totalDistanceApprox: true,
  segments: [
    [
      [13.75, 100.5],
      [13.76, 100.5],
    ],
    [
      [13.79, 100.6],
      [13.8, 100.6],
    ],
  ],
  gaps: [
    {
      kind: 'gap',
      startAt: '2026-11-23T01:30:00.000Z',
      endAt: '2026-11-23T02:30:00.000Z',
      seconds: 3600,
      from: { lat: 13.76, lng: 100.5 },
      to: { lat: 13.79, lng: 100.6 },
      distanceM: 11_300,
    },
  ],
  timeline: [],
};

function ViewBeforePaint({ onView }: { onView: (center: L.LatLng) => void }) {
  const map = useMap();
  useLayoutEffect(() => onView(map.getCenter()), [map, onView]);
  return null;
}

describe('RouteLayers (review #1)', () => {
  // jsdom has no SVGSVGElement.createSVGRect, so Leaflet thinks SVG is unsupported; browsers have it
  const browser = L.Browser as { svg: boolean };
  const hadSvg = browser.svg;
  beforeAll(() => {
    browser.svg = true;
  });
  afterAll(() => {
    browser.svg = hadSvg;
  });

  it('positions the route before its first paint instead of showing pins at the default view', () => {
    let center: L.LatLng | undefined;
    render(
      <LanguageProvider>
        <MapContainer center={[0, 0]} zoom={4} style={{ height: 400, width: 400 }}>
          <RouteLayers route={route} focus={null} />
          <ViewBeforePaint onView={(view) => { center = view; }} />
        </MapContainer>
      </LanguageProvider>,
    );
    expect(center?.lat).toBeGreaterThan(13);
    expect(center?.lat).toBeLessThan(14);
    expect(center?.lng).toBeGreaterThan(100);
    expect(center?.lng).toBeLessThan(101);
  });

  it('draws travelled segments solid and no-signal gaps dashed, even on a canvas-preferring map', () => {
    const { container } = render(
      <LanguageProvider>
        {/* same option as MapCanvas */}
        <MapContainer center={[13.77, 100.55]} zoom={12} preferCanvas style={{ height: 400, width: 400 }}>
          <RouteLayers route={route} focus={null} />
        </MapContainer>
      </LanguageProvider>,
    );
    const lines = container.querySelectorAll('path.route-line');
    const gaps = container.querySelectorAll('path.route-gap-line');
    expect(lines).toHaveLength(2);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].getAttribute('stroke-dasharray')).toBe('6 8');
    expect(lines[0].getAttribute('stroke-dasharray')).toBeNull();
  });
});

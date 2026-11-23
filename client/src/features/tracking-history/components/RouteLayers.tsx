import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { Marker, Polyline, Tooltip, useMap } from 'react-leaflet';

import { useLanguage } from '@/i18n/useLanguage';
import type { RouteHistory } from '../history.api';

const pin = (kind: 'start' | 'end' | 'stop', text = '') =>
  L.divIcon({
    className: 'route-pin-icon',
    html: `<span class="route-pin" data-kind="${kind}">${text}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

/**
 * Draws a built route: travelled segments (solid), no-signal gaps (dashed), start / end pins and
 * numbered stops. Fits the map to the route when it changes and flies to `focus` (a timeline click).
 */
export function RouteLayers({ route, focus }: { route: RouteHistory; focus: [number, number] | null }) {
  const map = useMap();
  const { t } = useLanguage();

  const bounds = useMemo(() => {
    const points: [number, number][] = route.segments.flat();
    if (route.start) points.push([route.start.lat, route.start.lng]);
    if (route.end) points.push([route.end.lat, route.end.lng]);
    return points.length ? L.latLngBounds(points) : null;
  }, [route]);

  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 17 });
  }, [map, bounds]);

  useEffect(() => {
    if (focus) map.setView(focus, Math.max(map.getZoom(), 16));
  }, [map, focus]);

  const stops = route.timeline.filter((item) => item.kind === 'stop');

  return (
    <>
      {route.segments.map((segment, i) => (
        <Polyline key={`seg-${i}`} positions={segment} pathOptions={{ className: 'route-line', weight: 4 }} />
      ))}
      {route.gaps.map((gap) => (
        <Polyline
          key={`gap-${gap.startAt}`}
          positions={[
            [gap.from.lat, gap.from.lng],
            [gap.to.lat, gap.to.lng],
          ]}
          pathOptions={{ className: 'route-gap-line', weight: 3 }}
        />
      ))}
      {stops.map((stop) => (
        <Marker key={`stop-${stop.index}`} position={[stop.lat, stop.lng]} icon={pin('stop', String(stop.index))} />
      ))}
      {route.start ? (
        <Marker position={[route.start.lat, route.start.lng]} icon={pin('start')}>
          <Tooltip>{t('tracking.history.start')}</Tooltip>
        </Marker>
      ) : null}
      {route.end ? (
        <Marker position={[route.end.lat, route.end.lng]} icon={pin('end')}>
          <Tooltip>{t('tracking.history.end')}</Tooltip>
        </Marker>
      ) : null}
    </>
  );
}

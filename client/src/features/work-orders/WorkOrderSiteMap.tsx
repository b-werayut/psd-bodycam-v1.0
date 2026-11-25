import { icon } from 'leaflet';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { Marker, Tooltip } from 'react-leaflet';

import { MapCanvas } from '@/components/map/MapCanvas';
import { cn } from '@/lib/utils';

const SITE_ICON = icon({
  iconUrl: markerIcon, iconRetinaUrl: markerIconRetina, shadowUrl: markerShadow,
  iconSize: [25, 41], iconAnchor: [12, 41], tooltipAnchor: [12, -28], shadowSize: [41, 41],
});

export function WorkOrderSiteMap({ point, name, className = 'h-72 sm:h-80' }: { point: [number, number]; name: string; className?: string }) {
  return <MapCanvas center={point} zoom={15} className={cn('min-h-0', className)}>
    <Marker position={point} icon={SITE_ICON} title={name} alt={name}>
      <Tooltip>{name}</Tooltip>
    </Marker>
  </MapCanvas>;
}

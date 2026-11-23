/** Bangkok — where the cameras work. */
export const MAP_DEFAULT_CENTER: [number, number] = [13.7563, 100.5018];
export const MAP_DEFAULT_ZOOM = 12;

const DEFAULT_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

type Env = Record<string, string | undefined>;

/**
 * Tile server for every map. OpenStreetMap's public tiles are for development only (their usage policy
 * forbids heavy production use) — production sets VITE_MAP_TILE_URL to our own / a paid tile server.
 */
export function tileLayerConfig(env: Env = import.meta.env as Env): { url: string; attribution: string } {
  const url = env.VITE_MAP_TILE_URL?.trim() || DEFAULT_TILE_URL;
  const attribution = env.VITE_MAP_TILE_ATTRIBUTION?.trim() || DEFAULT_ATTRIBUTION;
  return { url, attribution };
}

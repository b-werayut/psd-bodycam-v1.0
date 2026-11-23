import { describe, expect, it } from 'vitest';

import { MAP_DEFAULT_CENTER, tileLayerConfig } from './mapConfig';

describe('mapConfig', () => {
  it('centres on Bangkok', () => {
    expect(MAP_DEFAULT_CENTER).toEqual([13.7563, 100.5018]);
  });

  it('defaults to OpenStreetMap tiles', () => {
    const config = tileLayerConfig({});
    expect(config.url).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(config.attribution).toContain('OpenStreetMap');
  });

  it('reads VITE_MAP_TILE_URL / VITE_MAP_TILE_ATTRIBUTION (blank = default)', () => {
    expect(
      tileLayerConfig({ VITE_MAP_TILE_URL: 'https://tiles.local/{z}/{x}/{y}.png', VITE_MAP_TILE_ATTRIBUTION: 'PSD' }),
    ).toEqual({ url: 'https://tiles.local/{z}/{x}/{y}.png', attribution: 'PSD' });
    expect(tileLayerConfig({ VITE_MAP_TILE_URL: '  ' }).url).toContain('openstreetmap');
  });
});

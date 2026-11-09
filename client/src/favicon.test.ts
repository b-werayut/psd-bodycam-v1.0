import { describe, expect, it } from 'vitest';

import indexHtml from '../index.html?raw';

describe('application favicon', () => {
  it('publishes the selected PSD Sentinel aperture mark', () => {
    const document = new DOMParser().parseFromString(indexHtml, 'text/html');
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');

    expect(favicon?.type).toBe('image/png');
    expect(favicon?.getAttribute('href')).toBe(
      '/src/assets/logo/psd-sentinel-favicon.png',
    );
  });
});

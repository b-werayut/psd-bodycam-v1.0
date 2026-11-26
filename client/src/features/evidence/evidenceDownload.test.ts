import { describe, expect, it, vi } from 'vitest';

import { formatFileSize, isPending, resolveDownloadUrl, stateOfStatus, triggerBrowserDownload } from './evidenceDownload';

describe('evidenceDownload helpers', () => {
  it('maps statuses to states, unknown = queued', () => {
    expect([1, 2, 3, 4, 5].map(stateOfStatus)).toEqual(['queued', 'processing', 'ready', 'failed', 'expired']);
    expect(stateOfStatus(99)).toBe('queued');
    expect(isPending('processing')).toBe(true);
    expect(isPending('ready')).toBe(false);
  });

  it('formats file sizes', () => {
    expect(formatFileSize(null)).toBeNull();
    expect(formatFileSize('abc')).toBeNull();
    expect(formatFileSize('2048')).toBe('2 KB');
    expect(formatFileSize(String(310 * 1024 ** 2))).toBe('310 MB');
    expect(formatFileSize(String(2 * 1024 ** 3))).toBe('2.00 GB');
  });

  it('resolves the ticket url against an absolute API base only', () => {
    expect(resolveDownloadUrl('/api/evidence-exports/download?ticket=a', '/api')).toBe('/api/evidence-exports/download?ticket=a');
    expect(resolveDownloadUrl('/api/evidence-exports/download?ticket=a', 'https://api.example.com/api')).toBe(
      'https://api.example.com/api/evidence-exports/download?ticket=a',
    );
  });

  it('clicks a temporary anchor with download', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    triggerBrowserDownload('/api/x?ticket=1', 'a.mp4');
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download]')).toBeNull();
    click.mockRestore();
  });
});

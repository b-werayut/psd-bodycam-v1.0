import { describe, expect, it } from 'vitest';
import { cacheKey, deviceStatusCacheKey } from './cache-key';

describe('cache keys', () => {
  it('are split per database so dev and test never share cached values', () => {
    expect(deviceStatusCacheKey(5n, { DATABASE_URL: 'postgres://u:p@localhost:5432/bwc' })).toBe(
      'cache:bwc:device-status:5',
    );
    expect(deviceStatusCacheKey('5', { DATABASE_URL: 'postgres://u:p@localhost:5432/bwc_test' })).toBe(
      'cache:bwc_test:device-status:5',
    );
  });

  it('no or broken DATABASE_URL ⇒ plain cache prefix', () => {
    expect(cacheKey('x', {})).toBe('cache:x');
    expect(cacheKey('x', { DATABASE_URL: 'not a url' })).toBe('cache:x');
  });
});

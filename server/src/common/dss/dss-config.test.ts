import { describe, expect, it } from 'vitest';
import { readDssConfig } from './dss-config';

describe('readDssConfig', () => {
  it('defaults: mock driver, 10 s timeout, 100 simulated cameras', () => {
    expect(readDssConfig({})).toEqual({
      driver: 'mock',
      baseUrl: null,
      apiKey: null,
      timeoutMs: 10_000,
      mockDevices: 100,
    });
  });

  it('dss driver reads the base URL (trailing slash dropped) and the key', () => {
    expect(
      readDssConfig({
        DSS_DRIVER: 'dss',
        DSS_BASE_URL: ' http://dss.local:3004/ ',
        DSS_API_KEY: 'k'.repeat(32),
        DSS_TIMEOUT_MS: '5000',
      }),
    ).toEqual({
      driver: 'dss',
      baseUrl: 'http://dss.local:3004',
      apiKey: 'k'.repeat(32),
      timeoutMs: 5000,
      mockDevices: 100,
    });
  });

  it('dss driver without DSS_BASE_URL or DSS_API_KEY fails at boot naming the env', () => {
    expect(() => readDssConfig({ DSS_DRIVER: 'dss', DSS_API_KEY: 'k' })).toThrow(/DSS_BASE_URL/);
    expect(() => readDssConfig({ DSS_DRIVER: 'dss', DSS_BASE_URL: 'http://dss.local' })).toThrow(/DSS_API_KEY/);
  });

  it('rejects an unknown driver and out-of-range numbers', () => {
    expect(() => readDssConfig({ DSS_DRIVER: 'http' })).toThrow(/DSS_DRIVER/);
    expect(() => readDssConfig({ DSS_TIMEOUT_MS: '500' })).toThrow(/DSS_TIMEOUT_MS/);
    expect(() => readDssConfig({ DSS_TIMEOUT_MS: 'abc' })).toThrow(/DSS_TIMEOUT_MS/);
    expect(() => readDssConfig({ DSS_MOCK_DEVICES: '0' })).toThrow(/DSS_MOCK_DEVICES/);
    expect(() => readDssConfig({ DSS_MOCK_DEVICES: '1001' })).toThrow(/DSS_MOCK_DEVICES/);
    expect(readDssConfig({ DSS_MOCK_DEVICES: '3' }).mockDevices).toBe(3);
  });

  it('a malformed base URL fails at boot', () => {
    expect(() => readDssConfig({ DSS_DRIVER: 'dss', DSS_BASE_URL: '"http://x"', DSS_API_KEY: 'k' })).toThrow(
      /DSS_BASE_URL/,
    );
  });
});

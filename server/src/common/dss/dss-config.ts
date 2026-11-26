type Env = Record<string, string | undefined>;

export type DssDriver = 'dss' | 'mock';

export type DssConfig = {
  /** `dss` = psd-bwc-dss-services over HTTP · `mock` = the built-in simulator (DL56) */
  driver: DssDriver;
  baseUrl: string | null;
  apiKey: string | null;
  timeoutMs: number;
  mockDevices: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MOCK_DEVICES = 100;

function intEnv(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    throw new Error(`env ${key}='${raw}' is invalid - must be an integer from ${min} to ${max}`);
  }
  return Number(raw);
}

/** Reads the DSS env at boot; a broken value stops the process with the env name in the message. */
export function readDssConfig(env: Env): DssConfig {
  const driverRaw = (env.DSS_DRIVER ?? '').trim().toLowerCase() || 'mock';
  if (driverRaw !== 'dss' && driverRaw !== 'mock') {
    throw new Error(`env DSS_DRIVER='${driverRaw}' is invalid - only dss | mock are accepted`);
  }
  const timeoutMs = intEnv(env, 'DSS_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 1000, 60_000);
  const mockDevices = intEnv(env, 'DSS_MOCK_DEVICES', DEFAULT_MOCK_DEVICES, 1, 1000);
  const baseUrl = (env.DSS_BASE_URL ?? '').trim().replace(/\/+$/, '') || null;
  const apiKey = (env.DSS_API_KEY ?? '').trim() || null;

  if (driverRaw === 'dss') {
    if (!baseUrl) throw new Error('DSS_DRIVER=dss but env DSS_BASE_URL is not set (host:port of psd-bwc-dss-services)');
    if (!apiKey) throw new Error('DSS_DRIVER=dss but env DSS_API_KEY is not set (= API_SECRET_KEY of psd-bwc-dss-services)');
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    } catch {
      throw new Error(`env DSS_BASE_URL='${baseUrl.slice(0, 120)}' is not a valid http(s) URL`);
    }
  }

  return { driver: driverRaw, baseUrl, apiKey, timeoutMs, mockDevices };
}

type Env = Record<string, string | undefined>;

/** Database name from DATABASE_URL (`bwc`, `bwc_test`), or null when absent / unparsable. */
export function databaseName(env: Env): string | null {
  const url = env.DATABASE_URL?.trim();
  if (!url) return null;
  try {
    return new URL(url).pathname.replace(/^\//, '') || null;
  } catch {
    return null;
  }
}

/** `cache:{database}` — dev (`bwc`) and tests (`bwc_test`) share one Redis without sharing values. */
function cachePrefix(env: Env): string {
  const database = databaseName(env);
  return database ? `cache:${database}` : 'cache';
}

export function cacheKey(key: string, env: Env = process.env): string {
  return `${cachePrefix(env)}:${key}`;
}

/** DL45: the screen camera-status cache, one key per camera. */
export function deviceStatusCacheKey(deviceId: bigint | string, env: Env = process.env): string {
  return cacheKey(`device-status:${deviceId}`, env);
}

type Env = Record<string, string | undefined>;

/** `cache:{database}` — dev (`bwc`) and tests (`bwc_test`) share one Redis without sharing values. */
function cachePrefix(env: Env): string {
  const url = env.DATABASE_URL?.trim();
  if (!url) return 'cache';
  try {
    const database = new URL(url).pathname.replace(/^\//, '');
    return database ? `cache:${database}` : 'cache';
  } catch {
    return 'cache';
  }
}

export function cacheKey(key: string, env: Env = process.env): string {
  return `${cachePrefix(env)}:${key}`;
}

/** DL45: the screen camera-status cache, one key per camera. */
export function deviceStatusCacheKey(deviceId: bigint | string, env: Env = process.env): string {
  return cacheKey(`device-status:${deviceId}`, env);
}

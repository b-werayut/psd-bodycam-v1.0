export function lockPrefix(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.LOCK_PREFIX?.trim();
  if (explicit) return explicit;
  const url = env.DATABASE_URL?.trim();
  if (!url) return 'lock';
  try {
    const database = new URL(url).pathname.replace(/^\//, '');
    return database ? `lock:${database}` : 'lock';
  } catch {
    return 'lock';
  }
}

export function lockKey(key: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${lockPrefix(env)}:${key}`;
}

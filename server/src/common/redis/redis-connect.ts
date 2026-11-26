import type { Logger } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';


export type OptionalRedisLog = {
  /** shown in brackets: `Redis (lock)` */
  label: string;
  connected: string;
  /** what the service does until Redis answers — appended to the "can't connect" error */
  fallback: string;
  recovered: string;
};

/**
 * Client for a service that works without Redis and uses it once it answers (lock, rate limit).
 * No REDIS_URL = null. A failed first connect still returns the client: node-redis keeps reconnecting,
 * and callers check `isReady` on every use. Connection errors are logged once, not on every retry.
 */
export async function openOptionalRedis(
  logger: Logger,
  log: OptionalRedisLog,
): Promise<RedisClientType | null> {
  const url = redisUrl();
  if (!url) return null;

  const client = createClient({ url }) as RedisClientType;
  let warned = false;
  client.on('error', (error: Error) => {
    if (warned) return;
    warned = true;
    logger.warn(`Redis connection (${log.label}) problem: ${error.message}`);
  });

  if (await connectWithDeadline(client)) {
    logger.log(log.connected);
    return client;
  }
  logger.error(`Cannot connect to Redis (${log.label}) yet (${url}) — ${log.fallback}`);
  client.once('ready', () => logger.log(log.recovered));
  return client;
}

export function redisConnectTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number((env.REDIS_CONNECT_TIMEOUT_MS ?? '').trim());
  return Number.isInteger(raw) && raw >= 500 && raw <= 60_000 ? raw : 5_000;
}

export async function connectWithDeadline(
  client: RedisClientType,
  timeoutMs = redisConnectTimeoutMs(),
): Promise<boolean> {
  const attempt = client.connect().then(
    () => true,
    () => false,
  );
  const deadline = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
  });
  return Promise.race([attempt, deadline]);
}

export async function closeRedis(client: RedisClientType): Promise<void> {
  if (client.isReady) {
    const quitDeadline = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      timer.unref();
    });
    try {
      await Promise.race([client.quit().then(() => undefined), quitDeadline]);
    } catch {
      // quit failed (connection already broken) — fall through to destroy/disconnect
    }
  }
  if (!client.isOpen) return;

  try {
    (client as unknown as { destroy?: () => void }).destroy?.();
  } catch {
    // shutting down: nothing useful to do with this error
  }
  if (!client.isOpen) return;
  try {
    await client.disconnect();
  } catch {
    // shutting down: nothing useful to do with this error
  }
}

export function redisUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = (env.REDIS_URL ?? '').trim();
  return url || null;
}

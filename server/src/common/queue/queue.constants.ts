import IORedis from 'ioredis';
import { databaseName } from '../redis/cache-key';

export const BOOKING_INBOX = 'booking-inbox';

export type BookingInboxJob = { inboxId: string };

/** `bq-{database}` — dev (`bwc`) and tests (`bwc_test`) share one Redis without sharing queues. */
export function queuePrefix(env: Record<string, string | undefined> = process.env): string {
  return `bq-${databaseName(env) ?? 'default'}`;
}

/**
 * BullMQ needs its own ioredis connection (the app's node-redis client cannot be used).
 * The producer fails fast when Redis is down (`add` rejects instead of hanging the request).
 */
export function queueConnection(url: string, role: 'producer' | 'worker'): IORedis {
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    ...(role === 'producer' ? { enableOfflineQueue: false } : {}),
  });
}

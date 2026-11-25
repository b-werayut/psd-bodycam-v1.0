import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { BOOKING_INBOX, queueConnection, queuePrefix, type BookingInboxJob } from './queue.constants';

/** `Queue<BookingInboxJob> | null` — null = REDIS_URL not set. */
export const BOOKING_INBOX_QUEUE = Symbol('BOOKING_INBOX_QUEUE');
const QUEUE_CONNECTION = Symbol('QUEUE_CONNECTION');

@Injectable()
class QueueLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(BOOKING_INBOX_QUEUE) private readonly queue: Queue<BookingInboxJob> | null,
    @Inject(QUEUE_CONNECTION) private readonly connection: IORedis | null,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
    this.connection?.disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: QUEUE_CONNECTION,
      useFactory: (): IORedis | null => {
        const url = (process.env.REDIS_URL ?? '').trim();
        if (!url) return null;
        const connection = queueConnection(url, 'producer');
        // Without a listener ioredis would print every reconnect error unhandled.
        connection.on('error', (err) => new Logger('Queue').warn(`Redis queue connection: ${err.message}`));
        return connection;
      },
    },
    {
      provide: BOOKING_INBOX_QUEUE,
      inject: [QUEUE_CONNECTION],
      useFactory: (connection: IORedis | null): Queue<BookingInboxJob> | null =>
        connection ? new Queue<BookingInboxJob>(BOOKING_INBOX, { connection, prefix: queuePrefix() }) : null,
    },
    QueueLifecycle,
  ],
  exports: [BOOKING_INBOX_QUEUE],
})
export class QueueModule {}

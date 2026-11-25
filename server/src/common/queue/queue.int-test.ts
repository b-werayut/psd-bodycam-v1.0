import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventually } from '../../test/int-helpers';
import { BOOKING_INBOX, queueConnection, queuePrefix, type BookingInboxJob } from './queue.constants';
import { BOOKING_INBOX_QUEUE, QueueModule } from './queue.module';

@Module({ imports: [QueueModule] })
class QueueTestModule {}

describe('booking-inbox queue with Redis', () => {
  let app: INestApplicationContext;
  let queue: Queue<BookingInboxJob>;
  const received: BookingInboxJob[] = [];
  let worker: Worker<BookingInboxJob>;
  let workerConnection: ReturnType<typeof queueConnection>;

  beforeAll(async () => {
    app = await NestFactory.createApplicationContext(QueueTestModule, { logger: false });
    queue = app.get(BOOKING_INBOX_QUEUE);
    expect(queue).not.toBeNull();
    await queue.obliterate({ force: true });
  });
  afterAll(async () => {
    await worker?.close();
    workerConnection?.disconnect();
    await queue?.obliterate({ force: true });
    await app.close();
  });

  it('a job added to booking-inbox reaches a worker with the same prefix', async () => {
    workerConnection = queueConnection(process.env.REDIS_URL!, 'worker');
    worker = new Worker<BookingInboxJob>(
      BOOKING_INBOX,
      async (job) => {
        received.push(job.data);
      },
      { connection: workerConnection, prefix: queuePrefix() },
    );
    await queue.add('process', { inboxId: '1' });
    const got = await eventually(async () => (received.length ? received[0] : undefined));
    expect(got).toEqual({ inboxId: '1' });
  });
});

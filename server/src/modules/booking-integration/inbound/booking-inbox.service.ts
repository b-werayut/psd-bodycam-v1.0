import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { BOOKING_INBOX, type BookingInboxJob } from '../../../common/queue/queue.constants';
import { BOOKING_INBOX_QUEUE } from '../../../common/queue/queue.module';
import { DRIZZLE } from '../../../db/db.constants';
import type { DrizzleDB } from '../../../db/db.types';
import { IntegrationInbox, IntegrationSyncState } from '../../../db/schema';
import { BOOKING_SOURCE, safeErrorSummary } from './inbound-call-log.service';
import { externalEventIdOf, type InboundEnvelopeV1 } from './inbound-body';

const ENQUEUE_TIMEOUT_MS = 1000;

export type ReceiveResult = { status: 'accepted' | 'duplicate'; inboxId: bigint | null; externalJobId: string };

@Injectable()
export class BookingInboxService {
  private readonly logger = new Logger(BookingInboxService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(BOOKING_INBOX_QUEUE) private readonly queue: Queue<BookingInboxJob> | null,
  ) {}

  /** Stores the raw body (nothing else) and hands it to the worker through the queue. */
  async receive(envelope: InboundEnvelopeV1, payload: unknown): Promise<ReceiveResult> {
    const externalEventId = externalEventIdOf(envelope);
    const inboxId = await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(IntegrationInbox)
        .values({
          Source: BOOKING_SOURCE,
          ExternalEventId: externalEventId,
          EventType: envelope.eventType ?? null,
          Channel: 1,
          Payload: payload,
          Status: 1,
        })
        .onConflictDoNothing({ target: [IntegrationInbox.Source, IntegrationInbox.ExternalEventId] })
        .returning({ id: IntegrationInbox.Id });
      await tx
        .insert(IntegrationSyncState)
        .values({ Source: BOOKING_SOURCE, Resource: 'jobs', LastReceivedAt: sql`now()` })
        .onConflictDoUpdate({
          target: [IntegrationSyncState.Source, IntegrationSyncState.Resource],
          set: { LastReceivedAt: sql`now()` },
        });
      return inserted[0]?.id ?? null;
    });

    const externalJobId = envelope.job.jobId;
    if (inboxId === null) return { status: 'duplicate', inboxId: null, externalJobId };

    await this.enqueue(inboxId);
    return { status: 'accepted', inboxId, externalJobId };
  }

  /** After commit. A failure is only a warning: the worker's retry sweep picks up the Pending row. */
  private async enqueue(inboxId: bigint): Promise<void> {
    if (!this.queue) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.queue.add(
          BOOKING_INBOX,
          { inboxId: String(inboxId) },
          { jobId: `inbox-${inboxId}`, removeOnComplete: 1000, removeOnFail: 1000 },
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`enqueue timeout ${ENQUEUE_TIMEOUT_MS} ms`)), ENQUEUE_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      this.logger.warn(`ส่ง inbox ${inboxId} เข้าคิวไม่สำเร็จ (retry sweep จะหยิบเอง): ${safeErrorSummary(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

import { Module } from '@nestjs/common';
import { WorkOrdersWriterModule } from '../work-orders/work-orders-writer.module';
import { BookingInboxProcessor } from './processing/booking-inbox.processor';
import { BookingInboxWorker } from './processing/booking-inbox.worker';
import { InboxRetryJob } from './processing/inbox-retry.job';
import { BookingProjectionService } from './projection/booking-projection.service';

/**
 * Worker role `integration`: inbox processing. Never loaded by the api process. From `work-orders` it
 * imports only the writer module (Part 2 §2.4 rule 1).
 */
@Module({
  imports: [WorkOrdersWriterModule],
  providers: [BookingProjectionService, BookingInboxProcessor, BookingInboxWorker, InboxRetryJob],
})
export class IntegrationWorkerModule {}

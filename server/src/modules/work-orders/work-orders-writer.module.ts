import { Module } from '@nestjs/common';
import { WorkOrderWriter } from './work-order-writer.service';

/** The one piece of `work-orders` that `booking-integration` may import (Part 2 §2.4 rule 1). */
@Module({
  providers: [WorkOrderWriter],
  exports: [WorkOrderWriter],
})
export class WorkOrdersWriterModule {}

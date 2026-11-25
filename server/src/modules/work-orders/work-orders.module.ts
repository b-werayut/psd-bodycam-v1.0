import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { WorkOrdersController } from './work-orders.controller';
import { WorkOrdersService } from './work-orders.service';

/** Work-order read API (`api` process). The writer lives in WorkOrdersWriterModule. */
@Module({
  imports: [DevicesModule],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService],
})
export class WorkOrdersModule {}

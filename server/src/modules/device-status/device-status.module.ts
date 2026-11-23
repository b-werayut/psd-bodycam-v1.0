import { Module } from '@nestjs/common';
import { DeviceStatusService } from './device-status.service';

@Module({
  providers: [DeviceStatusService],
  exports: [DeviceStatusService],
})
export class DeviceStatusModule {}

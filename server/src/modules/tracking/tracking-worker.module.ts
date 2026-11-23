import { Module } from '@nestjs/common';
import { DeviceStatusModule } from '../device-status/device-status.module';
import { DeviceSyncJob } from '../devices/device-sync.job';
import { DevicesModule } from '../devices/devices.module';
import { GpsPollService } from './gps-poll.service';
import { PartitionMaintenanceJob } from './partition-maintenance.job';
import { TrackingModule } from './tracking.module';

/** Worker role `tracking`: the timed jobs. Never loaded by the api process. */
@Module({
  imports: [DevicesModule, DeviceStatusModule, TrackingModule],
  providers: [DeviceSyncJob, GpsPollService, PartitionMaintenanceJob],
})
export class TrackingWorkerModule {}

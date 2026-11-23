import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { DeviceStatusDisplayService } from './device-status-display.service';
import { DeviceSyncService } from './device-sync.service';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

/** Devices: read API + DeviceSync (the job itself runs only in the worker, see TrackingWorkerModule). */
@Module({
  imports: [AlertsModule],
  controllers: [DevicesController],
  providers: [DeviceSyncService, DeviceStatusDisplayService, DevicesService],
  exports: [DeviceSyncService, DeviceStatusDisplayService],
})
export class DevicesModule {}

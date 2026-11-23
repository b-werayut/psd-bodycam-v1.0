import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { GpsIngestService } from './gps-ingest.service';
import { TrackingController } from './tracking.controller';
import { TrackingReadService } from './tracking-read.service';

/** Tracking: read API (api) + GPS ingest (used by the worker's GpsPoll). */
@Module({
  imports: [DevicesModule],
  controllers: [TrackingController],
  providers: [GpsIngestService, TrackingReadService],
  exports: [GpsIngestService],
})
export class TrackingModule {}

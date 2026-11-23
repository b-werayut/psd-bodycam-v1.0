import { Module } from '@nestjs/common';
import { AlertWriterService } from './alert-writer.service';

@Module({
  providers: [AlertWriterService],
  exports: [AlertWriterService],
})
export class AlertsModule {}

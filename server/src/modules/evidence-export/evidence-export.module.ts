import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EvidenceExportController } from './evidence-export.controller';
import { EvidenceExportService } from './evidence-export.service';

@Module({
  imports: [AuthModule],
  controllers: [EvidenceExportController],
  providers: [EvidenceExportService],
  exports: [EvidenceExportService],
})
export class EvidenceExportModule {}

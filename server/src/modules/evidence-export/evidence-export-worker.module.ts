import { Module } from '@nestjs/common';
import { LiveStreamProvider } from '../streaming/live-stream.provider';
import { RecordingProvider } from '../streaming/recording-provider';
import { EvidenceCleanupJob } from './evidence-cleanup.job';
import { EvidenceExportProcessor } from './evidence-export.processor';
import { EvidenceExportWorker } from './evidence-export.worker';

/**
 * Worker role `media`: MP4 export processing and cleanup. Never loaded by the api process.
 * The two DSS providers are stateless (env + DSS client), so they are provided here directly
 * instead of importing StreamingModule, which would drag its controller into the worker.
 */
@Module({
  providers: [LiveStreamProvider, RecordingProvider, EvidenceExportProcessor, EvidenceExportWorker, EvidenceCleanupJob],
})
export class EvidenceExportWorkerModule {}

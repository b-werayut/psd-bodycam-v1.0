import { DynamicModule, Module } from '@nestjs/common';
import { AppModule } from './app.module';
import type { WorkerRole } from './common/config/worker-roles';
import { EvidenceExportWorkerModule } from './modules/evidence-export/evidence-export-worker.module';
import { IntegrationWorkerModule } from './modules/booking-integration/integration-worker.module';
import { TrackingWorkerModule } from './modules/tracking/tracking-worker.module';

@Module({})
export class WorkerModule {
  /** Role modules keyed by role (media = MP4 export). */
  static forRoles(roles: WorkerRole[]): DynamicModule {
    const imports: DynamicModule['imports'] = [AppModule];
    if (roles.includes('tracking')) imports.push(TrackingWorkerModule);
    if (roles.includes('integration')) imports.push(IntegrationWorkerModule);
    if (roles.includes('media')) imports.push(EvidenceExportWorkerModule);
    return { module: WorkerModule, imports };
  }
}

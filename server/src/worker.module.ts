import { DynamicModule, Module } from '@nestjs/common';
import { AppModule } from './app.module';
import type { WorkerRole } from './common/config/worker-roles';
import { TrackingWorkerModule } from './modules/tracking/tracking-worker.module';

@Module({})
export class WorkerModule {
  /** Role modules keyed by role (integration / media come with later phases). */
  static forRoles(roles: WorkerRole[]): DynamicModule {
    const imports: DynamicModule['imports'] = [AppModule];
    if (roles.includes('tracking')) imports.push(TrackingWorkerModule);
    return { module: WorkerModule, imports };
  }
}

import { DynamicModule, Module } from '@nestjs/common';
import { AppModule } from './app.module';
import type { WorkerRole } from './common/config/worker-roles';

@Module({})
export class WorkerModule {
  /** Role modules (tracking/integration/media) are added by later phases, keyed by role. */
  static forRoles(roles: WorkerRole[]): DynamicModule {
    void roles;
    return { module: WorkerModule, imports: [AppModule] };
  }
}

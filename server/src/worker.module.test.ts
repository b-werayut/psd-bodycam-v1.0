import { describe, expect, it } from 'vitest';
import { IntegrationWorkerModule } from './modules/booking-integration/integration-worker.module';
import { TrackingWorkerModule } from './modules/tracking/tracking-worker.module';
import { WorkerModule } from './worker.module';

describe('WorkerModule.forRoles', () => {
  it('the tracking role loads the tracking jobs', () => {
    expect(WorkerModule.forRoles(['tracking']).imports).toContain(TrackingWorkerModule);
    expect(WorkerModule.forRoles(['tracking', 'integration', 'media']).imports).toContain(TrackingWorkerModule);
  });

  it('other roles do not', () => {
    expect(WorkerModule.forRoles(['integration', 'media']).imports).not.toContain(TrackingWorkerModule);
  });

  it('integration role imports IntegrationWorkerModule', () => {
    expect(WorkerModule.forRoles(['integration']).imports).toContain(IntegrationWorkerModule);
    expect(WorkerModule.forRoles(['tracking', 'integration', 'media']).imports).toContain(IntegrationWorkerModule);
    expect(WorkerModule.forRoles(['tracking', 'media']).imports).not.toContain(IntegrationWorkerModule);
  });
});

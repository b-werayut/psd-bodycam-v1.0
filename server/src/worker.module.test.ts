import { describe, expect, it } from 'vitest';
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
});

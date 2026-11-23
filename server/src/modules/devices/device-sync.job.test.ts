import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceSyncJob, DEVICE_SYNC_INTERVAL_MS } from './device-sync.job';
import type { DeviceSyncService } from './device-sync.service';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('DeviceSyncJob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('syncs at bootstrap, then every hour after the previous run ends', async () => {
    const syncOnce = vi.fn().mockResolvedValue(null);
    const job = new DeviceSyncJob({ syncOnce } as unknown as DeviceSyncService);
    job.onApplicationBootstrap();
    await flush();
    expect(syncOnce).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEVICE_SYNC_INTERVAL_MS - 1);
    expect(syncOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(syncOnce).toHaveBeenCalledTimes(2);
    expect(DEVICE_SYNC_INTERVAL_MS).toBe(3_600_000);
    job.onApplicationShutdown();
  });

  it('a failed run (DSS down) is logged and the next run still happens', async () => {
    const syncOnce = vi.fn().mockRejectedValueOnce(new Error('DSS down')).mockResolvedValue(null);
    const job = new DeviceSyncJob({ syncOnce } as unknown as DeviceSyncService);
    job.onApplicationBootstrap();
    await flush();
    await vi.advanceTimersByTimeAsync(DEVICE_SYNC_INTERVAL_MS);
    expect(syncOnce).toHaveBeenCalledTimes(2);
    job.onApplicationShutdown();
  });

  it('shutdown stops the schedule', async () => {
    const syncOnce = vi.fn().mockResolvedValue(null);
    const job = new DeviceSyncJob({ syncOnce } as unknown as DeviceSyncService);
    job.onApplicationBootstrap();
    await flush();
    job.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(DEVICE_SYNC_INTERVAL_MS * 3);
    expect(syncOnce).toHaveBeenCalledTimes(1);
  });
});

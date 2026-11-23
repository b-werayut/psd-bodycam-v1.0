import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsService } from '../../common/settings/settings.service';
import { GpsPollService, gpsPollOptions, runPool } from './gps-poll.service';

describe('gpsPollOptions', () => {
  it('on by default with 8 requests at once', () => {
    expect(gpsPollOptions({})).toEqual({ enabled: true, concurrency: 8 });
  });

  it('GPS_POLL_ENABLED=false / 0 / no turns it off', () => {
    for (const value of ['false', '0', 'no', ' FALSE ']) expect(gpsPollOptions({ GPS_POLL_ENABLED: value }).enabled).toBe(false);
    expect(gpsPollOptions({ GPS_POLL_ENABLED: 'true' }).enabled).toBe(true);
  });

  it('GPS_POLL_CONCURRENCY is clamped to 1–32; garbage keeps the default', () => {
    expect(gpsPollOptions({ GPS_POLL_CONCURRENCY: '0' }).concurrency).toBe(1);
    expect(gpsPollOptions({ GPS_POLL_CONCURRENCY: '64' }).concurrency).toBe(32);
    expect(gpsPollOptions({ GPS_POLL_CONCURRENCY: 'x' }).concurrency).toBe(8);
    expect(gpsPollOptions({ GPS_POLL_CONCURRENCY: '4' }).concurrency).toBe(4);
  });
});

describe('runPool', () => {
  it('runs every item once with at most `size` at a time', async () => {
    let active = 0;
    let peak = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      done.push(n);
      active--;
    });
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it('an empty list finishes at once', async () => {
    const worker = vi.fn();
    await runPool([], 4, worker);
    expect(worker).not.toHaveBeenCalled();
  });
});

describe('GpsPollService.loop (Review Focus 1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const build = () => {
    const settings = { getInt: vi.fn().mockResolvedValue(15) } as unknown as SettingsService;
    return new GpsPollService(
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      settings,
    );
  };

  it('a cycle slower than the interval never overlaps: the next starts 15 s after the previous ends', async () => {
    const service = build();
    let running = 0;
    let overlapped = false;
    const starts: number[] = [];
    const tick = vi.spyOn(service, 'tick').mockImplementation(async () => {
      if (running > 0) overlapped = true;
      running++;
      starts.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 40_000)); // 40 s cycle > 15 s interval
      running--;
      return { devices: 100, observed: 100, fixes: 77, failed: 0, elapsedMs: 40_000 };
    });

    service.start();
    await vi.advanceTimersByTimeAsync(40_000 + 15_000 + 40_000 + 15_000 + 1);
    service.stop();

    expect(tick).toHaveBeenCalledTimes(3);
    expect(overlapped).toBe(false);
    expect(starts[1] - starts[0]).toBe(55_000);
    expect(starts[2] - starts[1]).toBe(55_000);
  });

  it('a failing cycle is logged and the loop goes on', async () => {
    const service = build();
    const tick = vi
      .spyOn(service, 'tick')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(null);
    service.start();
    await vi.advanceTimersByTimeAsync(15_001);
    service.stop();
    expect(tick).toHaveBeenCalledTimes(2);
  });
});

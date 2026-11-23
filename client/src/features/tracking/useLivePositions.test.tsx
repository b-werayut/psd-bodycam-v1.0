import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackingApi, type PositionsResponse } from './tracking.api';
import { useLivePositions } from './useLivePositions';

type Listener = (payload: unknown) => void;
const realtime = vi.hoisted(() => ({
  connected: true,
  listeners: new Map<string, Set<(payload: unknown) => void>>(),
}));

vi.mock('@/providers/RealtimeProvider', () => ({
  useRealtime: () => ({
    connected: realtime.connected,
    subscribe: (event: string, listener: Listener) => {
      const set = realtime.listeners.get(event) ?? new Set();
      set.add(listener);
      realtime.listeners.set(event, set);
      return () => set.delete(listener);
    },
  }),
}));

vi.mock('./tracking.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tracking.api')>();
  return { ...actual, trackingApi: { positions: vi.fn() } };
});

const snapshot: PositionsResponse = {
  data: [
    {
      deviceId: '1',
      deviceCode: 'SIM-0001',
      name: null,
      lat: 13.75,
      lng: 100.5,
      speedKph: null,
      heading: null,
      lastFixAt: '2026-11-23T03:00:00.000Z',
      fixValid: true,
      platformState: 'online',
      platformStatusFetchedAt: null,
    },
  ],
  total: 1,
  fixActiveSeconds: 150,
};

const emit = (event: string, payload: unknown) => {
  for (const listener of realtime.listeners.get(event) ?? []) listener(payload);
};
const gps = (recordedAt: string, lat: number) =>
  emit('gps:batch', { points: [{ deviceId: '1', lat, lng: 100.5, speedKph: null, heading: null, recordedAt, isValidFix: true }] });

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useLivePositions', () => {
  beforeEach(() => {
    // fake from the start: the hook's interval and react-query's poll are created at mount
    vi.useFakeTimers({ shouldAdvanceTime: true });
    realtime.connected = true;
    realtime.listeners.clear();
    vi.mocked(trackingApi.positions).mockResolvedValue(snapshot);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('starts from the snapshot', async () => {
    const { result } = renderHook(() => useLivePositions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.devices).toHaveLength(1));
    expect(result.current.fixActiveSeconds).toBe(150);
  });

  it('queues gps:batch and applies it once per second (three events ⇒ one update)', async () => {
    const renders = { count: 0 };
    const { result } = renderHook(
      () => {
        renders.count++;
        return useLivePositions();
      },
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.devices).toHaveLength(1));
    const before = renders.count;
    act(() => {
      gps('2026-11-23T03:00:10.000Z', 13.76);
      gps('2026-11-23T03:00:20.000Z', 13.77);
      gps('2026-11-23T03:00:30.000Z', 13.78);
    });
    expect(result.current.devices[0].lat).toBe(13.75);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.devices[0]).toMatchObject({ lat: 13.78, live: true });
    expect(renders.count - before).toBe(1);
  });

  it('refetches the snapshot every 60 s even while connected, and at once on a reconnect (review #7)', async () => {
    const { result, rerender } = renderHook(() => useLivePositions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.devices).toHaveLength(1));
    expect(trackingApi.positions).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(trackingApi.positions).toHaveBeenCalledTimes(2);

    realtime.connected = false;
    rerender();
    realtime.connected = true;
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(trackingApi.positions).toHaveBeenCalledTimes(3);
  });

  it('a snapshot refetch does not pull a live marker back (review #11)', async () => {
    const { result } = renderHook(() => useLivePositions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.devices).toHaveLength(1));
    act(() => gps('2026-11-23T03:00:30.000Z', 13.9));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.devices[0].lat).toBe(13.9);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(trackingApi.positions).toHaveBeenCalledTimes(2);
    expect(result.current.devices[0].lat).toBe(13.9);
  });
});

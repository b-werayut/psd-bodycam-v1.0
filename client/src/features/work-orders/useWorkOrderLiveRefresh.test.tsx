import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkOrderLiveRefresh } from './useWorkOrderLiveRefresh';

type Listener = (payload: unknown) => void;
const realtime = vi.hoisted(() => ({ listeners: new Map<string, Set<(p: unknown) => void>>() }));

vi.mock('@/providers/RealtimeProvider', () => ({
  useRealtime: () => ({
    connected: true,
    subscribe: (event: string, listener: Listener) => {
      const set = realtime.listeners.get(event) ?? new Set();
      set.add(listener);
      realtime.listeners.set(event, set);
      return () => set.delete(listener);
    },
  }),
}));

const emit = (event: string, payload: unknown = {}) =>
  realtime.listeners.get(event)?.forEach((l) => l(payload));

beforeEach(() => {
  realtime.listeners.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('useWorkOrderLiveRefresh', () => {
  it('two workorder:changed within 800 ms invalidate once', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useWorkOrderLiveRefresh(), { wrapper });

    act(() => emit('workorder:changed'));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    act(() => emit('workorder:changed'));
    act(() => {
      vi.advanceTimersByTime(799);
    });
    expect(spy).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-orders', 'list'] });
  });

  it('refreshes the list without invalidating another order open in a dialog', () => {
    const client = new QueryClient();
    const listKey = ['work-orders', 'list', {}];
    const detailKey = ['work-orders', 'detail', '11'];
    client.setQueryData(listKey, []);
    client.setQueryData(detailKey, { id: '11' });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => {
      useWorkOrderLiveRefresh();
      useWorkOrderLiveRefresh('11');
    }, { wrapper });
    act(() => {
      emit('workorder:changed', { workOrderId: '12' });
      vi.advanceTimersByTime(800);
    });
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(false);
  });

  it('for one work order (the audited detail): a push for another order refreshes nothing', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useWorkOrderLiveRefresh('11'), { wrapper });

    act(() => emit('workorder:changed', { workOrderId: '12' }));
    act(() => emit('workorder:changed', {}));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('for one work order: a push for that order refreshes only its detail and timeline', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useWorkOrderLiveRefresh('11'), { wrapper });

    act(() => emit('workorder:changed', { workOrderId: '11' }));
    act(() => emit('workorder:changed', { workOrderId: '11' }));
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-orders', 'detail', '11'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['work-orders', 'events', '11'] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['work-orders'] });
  });
});

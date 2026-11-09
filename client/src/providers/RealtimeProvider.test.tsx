import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshToken, resetRefreshState } from '@/lib/apiClient';
import { resetQueryCache } from '@/lib/queryClient';
import { connectRealtime } from '@/lib/socket';
import { useAuthStore } from '@/stores/authStore';
import { RealtimeProvider, useRealtime } from './RealtimeProvider';

vi.mock('@/lib/socket', () => ({
  connectRealtime: vi.fn(),
  REALTIME_UNAUTHORIZED: 'unauthorized',
}));

vi.mock('@/lib/queryClient', () => ({ resetQueryCache: vi.fn() }));

vi.mock('@/lib/apiClient', () => ({
  refreshToken: vi.fn(() => Promise.resolve('fresh-token')),
  resetRefreshState: vi.fn(),
}));

type Listener = (...args: unknown[]) => void;

function makeFakeSocket() {
  const listeners = new Map<string, Set<Listener>>();
  const socket = {
    connected: false,
    on: vi.fn((event: string, listener: Listener) => {
      const eventListeners = listeners.get(event) ?? new Set<Listener>();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
      return socket;
    }),
    off: vi.fn((event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
      return socket;
    }),
    disconnect: vi.fn(() => socket),
    connect: vi.fn(() => socket),
  };

  return {
    socket,
    emit(event: string, ...args: unknown[]) {
      if (event === 'connect') socket.connected = true;
      if (event === 'disconnect') socket.connected = false;
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
  };
}

function Subscriber({
  event = 'alert:new',
  onEvent,
  onRender,
}: {
  event?: string;
  onEvent: Listener;
  onRender?: () => void;
}) {
  const realtime = useRealtime();
  onRender?.();

  useEffect(() => realtime.subscribe(event, onEvent), [event, onEvent, realtime]);

  return <output aria-label="socket status">{realtime.connected ? 'connected' : 'offline'}</output>;
}

describe('RealtimeProvider', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // ต้องล้าง notice ด้วย ไม่งั้นข้อความจากเทสต์ก่อนหน้าค้างมาให้เทสต์ถัดไปเห็นว่า "หลุด"
    useAuthStore.setState({ accessToken: 'token-a', user: null, notice: null });
    vi.mocked(refreshToken).mockResolvedValue('fresh-token');
  });

  it('creates one authenticated socket for multiple subscribers and exposes connection state', async () => {
    const fake = makeFakeSocket();
    vi.mocked(connectRealtime).mockReturnValue(fake.socket as never);

    render(
      <RealtimeProvider>
        <Subscriber onEvent={vi.fn()} />
        <Subscriber onEvent={vi.fn()} />
      </RealtimeProvider>,
    );

    await waitFor(() => expect(connectRealtime).toHaveBeenCalledTimes(1));
    expect(connectRealtime).toHaveBeenCalledWith(expect.any(Function));
    await waitFor(() => expect(fake.listenerCount('alert:new')).toBe(2));

    act(() => fake.emit('connect'));
    expect(screen.getAllByLabelText('socket status')[0]).toHaveTextContent('connected');
  });

  it('อ่าน token สดจาก store ทุกครั้งที่ต่อ (ไม่ใช่ค่าที่จับไว้ตอนแรก)', async () => {
    const fake = makeFakeSocket();
    vi.mocked(connectRealtime).mockReturnValue(fake.socket as never);

    render(
      <RealtimeProvider>
        <Subscriber onEvent={vi.fn()} />
      </RealtimeProvider>,
    );
    await waitFor(() => expect(connectRealtime).toHaveBeenCalledTimes(1));

    const getToken = vi.mocked(connectRealtime).mock.calls[0][0];
    expect(getToken()).toBe('token-a');

    act(() => {
      useAuthStore.setState({ accessToken: 'token-b' });
    });

    expect(getToken()).toBe('token-b');
  });

  it('**หมุน token ไม่ตัด socket ทิ้ง**ทั้งที่ยังต่อได้ (event ที่ยิงมาพอดีจะหาย)', async () => {
    const fake = makeFakeSocket();
    vi.mocked(connectRealtime).mockReturnValue(fake.socket as never);

    render(
      <RealtimeProvider>
        <Subscriber onEvent={vi.fn()} />
      </RealtimeProvider>,
    );
    await waitFor(() => expect(connectRealtime).toHaveBeenCalledTimes(1));

    act(() => {
      useAuthStore.setState({ accessToken: 'token-b' });
    });

    expect(connectRealtime).toHaveBeenCalledTimes(1);
    expect(fake.socket.disconnect).not.toHaveBeenCalled();
  });

  it('ออกจากระบบ (ไม่มี token) -> ตัด socket', async () => {
    const fake = makeFakeSocket();
    vi.mocked(connectRealtime).mockReturnValue(fake.socket as never);

    render(
      <RealtimeProvider>
        <Subscriber onEvent={vi.fn()} />
      </RealtimeProvider>,
    );
    await waitFor(() => expect(connectRealtime).toHaveBeenCalledTimes(1));

    act(() => {
      useAuthStore.setState({ accessToken: null });
    });

    expect(fake.socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('ต่อไม่ติด (token หมดอายุ) -> ขอ token ใหม่ให้ socket.io ลองต่อรอบถัดไป', async () => {
    const fake = makeFakeSocket();
    vi.mocked(connectRealtime).mockReturnValue(fake.socket as never);

    render(
      <RealtimeProvider>
        <Subscriber onEvent={vi.fn()} />
      </RealtimeProvider>,
    );
    await waitFor(() => expect(fake.listenerCount('connect_error')).toBe(1));

    act(() => fake.emit('connect_error', new Error('unauthorized')));

    expect(refreshToken).toHaveBeenCalled();
  });

  it('**server ปฏิเสธ token (`unauthorized`) -> ได้ token ใหม่แล้วสั่ง connect() เอง** (socket.io ไม่ลองต่อให้)', async () => {
    const fake = makeFakeSocket();
    vi.mocked(connectRealtime).mockReturnValue(fake.socket as never);

    render(
      <RealtimeProvider>
        <Subscriber onEvent={vi.fn()} />
      </RealtimeProvider>,
    );
    await waitFor(() => expect(fake.listenerCount('connect_error')).toBe(1));

    act(() => fake.emit('connect_error', new Error('unauthorized')));

    await waitFor(() => expect(fake.socket.connect).toHaveBeenCalledTimes(1));
  });

  it('เน็ตหลุด (error อื่น) -> ไม่ refresh และไม่สั่ง connect() เอง ปล่อยให้ socket.io ลองต่อตามรอบของมัน', async () => {
    const fake = makeFakeSocket();
    vi.mocked(connectRealtime).mockReturnValue(fake.socket as never);

    render(
      <RealtimeProvider>
        <Subscriber onEvent={vi.fn()} />
      </RealtimeProvider>,
    );
    await waitFor(() => expect(fake.listenerCount('connect_error')).toBe(1));

    act(() => fake.emit('connect_error', new Error('websocket error')));

    await Promise.resolve();
    await Promise.resolve();
    expect(refreshToken).not.toHaveBeenCalled();
    expect(fake.socket.connect).not.toHaveBeenCalled();
  });

  it('transport connect_error ซ้ำ ๆ (timeout / payload ไม่ใช่ Error) -> ไม่เรียก refresh เลย', async () => {
    const fake = makeFakeSocket();
    vi.mocked(connectRealtime).mockReturnValue(fake.socket as never);

    render(
      <RealtimeProvider>
        <Subscriber onEvent={vi.fn()} />
      </RealtimeProvider>,
    );
    await waitFor(() => expect(fake.listenerCount('connect_error')).toBe(1));

    act(() => {
      fake.emit('connect_error', new Error('timeout'));
      fake.emit('connect_error', new Error('xhr poll error'));
      fake.emit('connect_error', 'unauthorized');
    });

    await Promise.resolve();
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it('ขอ token ใหม่ไม่สำเร็จ -> ไม่ต่อใหม่ด้วย token เดิมที่ถูกปฏิเสธ', async () => {
    vi.mocked(refreshToken).mockResolvedValue(null);
    const fake = makeFakeSocket();
    vi.mocked(connectRealtime).mockReturnValue(fake.socket as never);

    render(
      <RealtimeProvider>
        <Subscriber onEvent={vi.fn()} />
      </RealtimeProvider>,
    );
    await waitFor(() => expect(fake.listenerCount('connect_error')).toBe(1));

    act(() => fake.emit('connect_error', new Error('unauthorized')));

    await waitFor(() => expect(refreshToken).toHaveBeenCalled());
    await Promise.resolve();
    expect(fake.socket.connect).not.toHaveBeenCalled();
  });

  it('**`session:revoked` scope account -> ออกจากระบบทันที ไม่ต้องรอ access token หมดอายุ**', async () => {
    const fake = makeFakeSocket();
    vi.mocked(connectRealtime).mockReturnValue(fake.socket as never);

    render(
      <RealtimeProvider>
        <Subscriber onEvent={vi.fn()} />
      </RealtimeProvider>,
    );
    await waitFor(() => expect(fake.listenerCount('session:revoked')).toBe(1));

    act(() => fake.emit('session:revoked', { scope: 'account', deviceId: null }));

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().notice).toEqual({ key: 'auth.sessionRevoked' });
    expect(resetQueryCache).toHaveBeenCalledTimes(1);
    expect(resetRefreshState).toHaveBeenCalledTimes(1);
  });

  it('**scope device -> เว็บต้องไม่หลุด** (ถอนมือถือที่หาย เว็บที่กำลังใช้อยู่ต้องอยู่ต่อ)', async () => {
    const fake = makeFakeSocket();
    vi.mocked(connectRealtime).mockReturnValue(fake.socket as never);

    render(
      <RealtimeProvider>
        <Subscriber onEvent={vi.fn()} />
      </RealtimeProvider>,
    );
    await waitFor(() => expect(fake.listenerCount('session:revoked')).toBe(1));

    act(() => fake.emit('session:revoked', { scope: 'device', deviceId: 'dev-a' }));

    expect(useAuthStore.getState().accessToken).toBe('token-a');
    expect(useAuthStore.getState().notice).toBeNull();
    expect(resetQueryCache).not.toHaveBeenCalled();
    expect(resetRefreshState).not.toHaveBeenCalled();
  });

  it('removes provider and subscriber listeners before disconnecting on unmount', async () => {
    const fake = makeFakeSocket();
    const onEvent = vi.fn();
    vi.mocked(connectRealtime).mockReturnValue(fake.socket as never);

    const view = render(
      <RealtimeProvider>
        <Subscriber onEvent={onEvent} />
      </RealtimeProvider>,
    );
    await waitFor(() => expect(fake.listenerCount('alert:new')).toBe(1));

    view.unmount();

    expect(fake.listenerCount('alert:new')).toBe(0);
    expect(fake.socket.off).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(fake.socket.off).toHaveBeenCalledWith('disconnect', expect.any(Function));
    expect(fake.socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('delivers GPS batches without storing them in provider state', async () => {
    const fake = makeFakeSocket();
    const onGps = vi.fn();
    const onRender = vi.fn();
    vi.mocked(connectRealtime).mockReturnValue(fake.socket as never);

    render(
      <RealtimeProvider>
        <Subscriber event="gps:batch" onEvent={onGps} onRender={onRender} />
      </RealtimeProvider>,
    );
    await waitFor(() => expect(fake.listenerCount('gps:batch')).toBe(1));
    act(() => fake.emit('connect'));
    const rendersAfterConnect = onRender.mock.calls.length;

    act(() => fake.emit('gps:batch', [{ deviceId: 'd1', lat: 13, lng: 100 }]));

    expect(onGps).toHaveBeenCalledWith([{ deviceId: 'd1', lat: 13, lng: 100 }]);
    expect(onRender).toHaveBeenCalledTimes(rendersAfterConnect);
  });
});

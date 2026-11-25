import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/authStore';
import { streamingApi } from './streaming.api';
import { settlePendingStops, stopStream, stopStreamOnPageHide } from './streamStops';

vi.mock('./streaming.api', () => ({ streamingApi: { stopLive: vi.fn() } }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  useAuthStore.setState({ accessToken: null });
});

describe('stopStream / settlePendingStops', () => {
  it('**รอ stop ที่ยังค้างก่อน** — ไม่งั้นจอใหม่ไปถึงก่อนแล้วชนโควตา', async () => {
    let finish: () => void = () => undefined;
    vi.mocked(streamingApi.stopLive).mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve(undefined as never);
      }),
    );

    void stopStream('tok-1');
    expect(streamingApi.stopLive).toHaveBeenCalledWith('tok-1');

    let settled = false;
    const waiting = settlePendingStops().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    finish();
    await waiting;
    expect(settled).toBe(true);
  });

  it('stop ล้มก็ถือว่าจบ ไม่ทำให้จอใหม่ล้มตาม', async () => {
    vi.mocked(streamingApi.stopLive).mockRejectedValue(new Error('network'));
    await expect(stopStream('tok-2')).resolves.toBeUndefined();
    await expect(settlePendingStops()).resolves.toBeUndefined();
  });

  it('API ค้าง: รอไม่เกินเพดาน แล้วปล่อยให้ server ตัดสินโควตาเอง', async () => {
    vi.useFakeTimers();
    vi.mocked(streamingApi.stopLive).mockReturnValue(new Promise(() => undefined));
    void stopStream('tok-hang');

    let settled = false;
    void settlePendingStops(1_000).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });
});

describe('stopStreamOnPageHide', () => {
  it('**ส่ง stop ด้วย keepalive fetch พร้อม access token** (axios ส่งหลังปิดหน้าไม่ได้)', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: 'access-1' });

    stopStreamOnPageHide('tok-3');

    expect(fetchMock).toHaveBeenCalledWith('/api/streams/tok-3/stop', {
      method: 'POST',
      keepalive: true,
      credentials: 'include',
      headers: { Authorization: 'Bearer access-1' },
    });
  });

  it('ไม่มี access token = ไม่ยิง (server ตอบ 401 อยู่แล้ว)', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    stopStreamOnPageHide('tok-4');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

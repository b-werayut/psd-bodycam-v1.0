import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/i18n/LanguageProvider';
import { useAuthStore } from '@/stores/authStore';
import { StreamPlayer } from './StreamPlayer';
import { STREAM_END_REASON, STREAM_STATUS, streamingApi, type LiveSession } from '../streaming.api';

const realtime = vi.hoisted(() => {
  const listeners = new Map<string, (payload: unknown) => void>();
  return {
    listeners,
    value: {
      connected: true,
      subscribe: (event: string, listener: (payload: unknown) => void) => {
        listeners.set(event, listener);
        return () => {
          listeners.delete(event);
        };
      },
    },
  };
});

const hls = vi.hoisted(() => {
  type HlsEventData = { fatal?: boolean; details?: string };

  class FakeHls {
    static Events = { ERROR: 'hlsError', MANIFEST_PARSED: 'manifestParsed' };
    static isSupported = vi.fn(() => false);
    static latest: FakeHls | null = null;

    readonly handlers = new Map<string, (event: string, data: HlsEventData) => void>();
    readonly loadSource = vi.fn();
    readonly attachMedia = vi.fn();
    readonly destroy = vi.fn();

    constructor() {
      FakeHls.latest = this;
    }

    on = vi.fn((event: string, listener: (event: string, data: HlsEventData) => void) => {
      this.handlers.set(event, listener);
    });

    emit(event: string, data: HlsEventData = {}) {
      this.handlers.get(event)?.(event, data);
    }
  }

  return { FakeHls };
});

vi.mock('@/providers/RealtimeProvider', () => ({ useRealtime: () => realtime.value }));

vi.mock('hls.js', () => ({
  default: hls.FakeHls,
}));

vi.mock('../streaming.api', async () => {
  const actual = await vi.importActual<typeof import('../streaming.api')>('../streaming.api');
  return {
    ...actual,
    streamingApi: {
      startLive: vi.fn(),
      startPlayback: vi.fn(),
      stopLive: vi.fn(),
      mySessions: vi.fn(),
    },
  };
});

const SESSION: LiveSession = {
  sessionToken: 'tok-stream-player',
  protocol: 1,
  device: { id: '1', deviceCode: '1000027', deviceName: 'Bodytest' },
  channel: 1,
  playbackUrl: '/api/streams/tok-stream-player/playlist.m3u8?s=sealed',
  idleTimeoutSeconds: 300,
};

const DEVICE = { deviceCode: '1000027', deviceName: 'Bodytest', onlineStatus: 1 };

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>{children}</LanguageProvider>
    </QueryClientProvider>
  );
}

function renderPlayer() {
  return render(<StreamPlayer device={DEVICE} />, { wrapper });
}

beforeEach(() => {
  vi.resetAllMocks();
  realtime.listeners.clear();
  hls.FakeHls.latest = null;
  hls.FakeHls.isSupported.mockReturnValue(false);
  window.localStorage.setItem('bodycam.language', 'th');
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.mocked(streamingApi.startLive).mockResolvedValue(SESSION);
  vi.mocked(streamingApi.startPlayback).mockResolvedValue({ ...SESSION, sessionToken: 'tok-pb' });
  vi.mocked(streamingApi.stopLive).mockResolvedValue({ success: true });
  vi.mocked(streamingApi.mySessions).mockResolvedValue({ data: [], limit: 4 });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** jsdom ไม่มี MediaSource — เทสต์ที่ต้องการเส้นทาง hls.js ต้องใส่เอง */
function withMediaSource() {
  vi.stubGlobal('MediaSource', class {});
}

describe('StreamPlayer', () => {
  it('stops a session that finishes opening after its screen was closed', async () => {
    let finish: (session: LiveSession) => void = () => undefined;
    vi.mocked(streamingApi.startLive).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const player = renderPlayer();
    await waitFor(() => expect(streamingApi.startLive).toHaveBeenCalledTimes(1));
    player.unmount();
    await act(async () => { finish(SESSION); });
    await waitFor(() => expect(streamingApi.stopLive).toHaveBeenCalledWith(SESSION.sessionToken));
  });

  it('เบราว์เซอร์เก่าที่ไม่มี video frame callback ใช้ loadeddata เป็น fallback', async () => {
    renderPlayer();

    const video = await screen.findByLabelText('ภาพสดจากกล้อง');

    expect(screen.getByText('กำลังขอภาพสดจากแพลตฟอร์มกล้อง…')).toBeInTheDocument();
    expect(video).not.toHaveAttribute('controls');

    fireEvent.loadedData(video);

    expect(screen.queryByText('กำลังขอภาพสดจากแพลตฟอร์มกล้อง…')).not.toBeInTheDocument();
    expect(video).toHaveAttribute('controls');
  });

  it('ยังไม่ถอดหน้าเชื่อมต่อจนกว่าเบราว์เซอร์จะวาดเฟรมแรกจริง', async () => {
    renderPlayer();

    const video = await screen.findByLabelText<HTMLVideoElement>('ภาพสดจากกล้อง');
    let presentFrame: VideoFrameRequestCallback | undefined;
    Object.defineProperty(video, 'requestVideoFrameCallback', {
      configurable: true,
      value: vi.fn((callback: VideoFrameRequestCallback) => {
        presentFrame = callback;
        return 1;
      }),
    });

    fireEvent.playing(video);

    expect(screen.getByText('กำลังขอภาพสดจากแพลตฟอร์มกล้อง…')).toBeInTheDocument();
    expect(video).not.toHaveAttribute('controls');

    act(() => presentFrame?.(0, {} as VideoFrameCallbackMetadata));

    expect(screen.queryByText('กำลังขอภาพสดจากแพลตฟอร์มกล้อง…')).not.toBeInTheDocument();
    expect(video).toHaveAttribute('controls');
  });

  it('ยอมรับ event playing เป็นสัญญาณว่าภาพพร้อมในเบราว์เซอร์ที่ไม่ส่ง loadeddata', async () => {
    renderPlayer();

    const video = await screen.findByLabelText('ภาพสดจากกล้อง');
    expect(screen.getByText('กำลังขอภาพสดจากแพลตฟอร์มกล้อง…')).toBeInTheDocument();

    fireEvent.playing(video);

    expect(screen.queryByText('กำลังขอภาพสดจากแพลตฟอร์มกล้อง…')).not.toBeInTheDocument();
    expect(video).toHaveAttribute('controls');
  });

  it('เส้นทาง hls.js เริ่มเล่นหลัง manifest พร้อมเหมือน player ระบบเก่า', async () => {
    withMediaSource();
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('');
    hls.FakeHls.isSupported.mockReturnValue(true);
    renderPlayer();

    const video = await screen.findByLabelText<HTMLVideoElement>('ภาพสดจากกล้อง');
    await waitFor(() => expect(hls.FakeHls.latest?.attachMedia).toHaveBeenCalledWith(video));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

    act(() => hls.FakeHls.latest?.emit('manifestParsed'));

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it('**Safari: เล่น native ได้แต่มี MSE -> ใช้ hls.js** ไม่ตั้ง video.src เป็น playlist', async () => {
    withMediaSource();
    hls.FakeHls.isSupported.mockReturnValue(true);
    renderPlayer();

    const video = await screen.findByLabelText<HTMLVideoElement>('ภาพสดจากกล้อง');
    await waitFor(() => expect(hls.FakeHls.latest?.attachMedia).toHaveBeenCalledWith(video));
    expect(hls.FakeHls.latest?.loadSource).toHaveBeenCalledWith(SESSION.playbackUrl);
    expect(video.getAttribute('src')).toBeNull();
  });

  it('ไม่มี MSE เลย (iOS ก่อน 17.1) -> native ทันที ไม่โหลด hls.js', async () => {
    renderPlayer();

    const video = await screen.findByLabelText<HTMLVideoElement>('ภาพสดจากกล้อง');
    await waitFor(() => expect(video.getAttribute('src')).toBe(SESSION.playbackUrl));
    expect(hls.FakeHls.isSupported).not.toHaveBeenCalled();
    expect(hls.FakeHls.latest).toBeNull();
  });

  it('**native เล่นไม่ได้ -> บอกผู้ใช้พร้อมเหตุผลจากเบราว์เซอร์** ไม่ค้างหน้ากำลังเชื่อมต่อ', async () => {
    renderPlayer();

    const video = await screen.findByLabelText<HTMLVideoElement>('ภาพสดจากกล้อง');
    await waitFor(() => expect(video.getAttribute('src')).toBe(SESSION.playbackUrl));
    Object.defineProperty(video, 'error', {
      configurable: true,
      value: { code: 4, message: 'CoreMediaErrorDomain error -12927' },
    });
    fireEvent.error(video);

    expect(
      await screen.findByText('เล่นภาพไม่ได้ (CoreMediaErrorDomain error -12927)'),
    ).toBeInTheDocument();
  });

  it('hls.js error ร้ายแรง -> แสดงรายละเอียดจาก hls.js ต่อท้าย', async () => {
    withMediaSource();
    hls.FakeHls.isSupported.mockReturnValue(true);
    renderPlayer();

    await waitFor(() => expect(hls.FakeHls.latest?.attachMedia).toHaveBeenCalled());
    act(() => hls.FakeHls.latest?.emit('hlsError', { fatal: true, details: 'fragLoadError' }));

    expect(await screen.findByText('เล่นภาพไม่ได้ (fragLoadError)')).toBeInTheDocument();
  });

  it('ไม่แสดงคำเตือน OnlineStatus ซ้ำกับข้อผิดพลาดของสตรีม', async () => {
    render(
      <StreamPlayer device={{ ...DEVICE, onlineStatus: 2 }} />,
      { wrapper },
    );

    await screen.findByLabelText('ภาพสดจากกล้อง');
    expect(
      screen.queryByText(
        'ระบบตรวจว่าอุปกรณ์นี้ขาดการติดต่อ — เปิดดูได้ แต่แพลตฟอร์มอาจไม่มีภาพให้',
      ),
    ).not.toBeInTheDocument();
  });
});

describe('StreamPlayer — ส่วนที่สายคุยผ่านกล้องใช้', () => {
  it('**แจ้ง onSessionChange หลังภาพเฟรมแรกพร้อม และแจ้ง null เมื่อ server ปิดจอ** (stream:status ENDED)', async () => {
    const onSessionChange = vi.fn();
    render(<StreamPlayer device={DEVICE} onSessionChange={onSessionChange} />, { wrapper });

    const video = await screen.findByLabelText<HTMLVideoElement>('ภาพสดจากกล้อง');
    expect(onSessionChange).not.toHaveBeenCalledWith(SESSION);

    fireEvent.loadedData(video);
    await waitFor(() => expect(onSessionChange).toHaveBeenLastCalledWith(SESSION));

    act(() =>
      realtime.listeners.get('stream:status')?.({
        sessionToken: SESSION.sessionToken,
        deviceId: SESSION.device.id,
        status: STREAM_STATUS.ENDED,
        endReason: STREAM_END_REASON.POLICY_DISABLED,
      }),
    );

    expect(onSessionChange).toHaveBeenLastCalledWith(null);
  });

  it('โหมด playback ไม่แจ้ง session ให้ผูกสายคุย (คุยได้เฉพาะภาพสด)', async () => {
    const onSessionChange = vi.fn();
    render(
      <StreamPlayer
        device={DEVICE}
        playback={{ startAt: '2026-09-24T01:00:00.000Z', endAt: '2026-09-24T01:10:00.000Z' }}
        onSessionChange={onSessionChange}
      />,
      { wrapper },
    );

    await screen.findByLabelText('ภาพสดจากกล้อง');
    expect(onSessionChange).not.toHaveBeenCalledWith(expect.objectContaining({ channel: 1 }));
  });

  it('**forceMuted: วิดีโอถูก mute และ unmute ไม่ได้** จนกว่าจะเลิกบังคับ', async () => {
    const { rerender } = render(<StreamPlayer device={DEVICE} forceMuted />, { wrapper });
    const video = await screen.findByLabelText<HTMLVideoElement>('ภาพสดจากกล้อง');

    video.muted = false;
    fireEvent(video, new Event('volumechange'));
    expect(video.muted).toBe(true);

    rerender(<StreamPlayer device={DEVICE} forceMuted={false} />);
    video.muted = false;
    fireEvent(video, new Event('volumechange'));
    expect(video.muted).toBe(false);
  });
});

describe('StreamPlayer — จอย่อยและการคืนโควตา', () => {
  it('**quietErrors: เล่นภาพไม่ได้ = "ไม่พบสัญญาณ" · ลองใหม่ปิด session เดิมก่อนขอใหม่**', async () => {
    withMediaSource();
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('');
    hls.FakeHls.isSupported.mockReturnValue(true);
    render(<StreamPlayer device={DEVICE} compact fill quietErrors />, { wrapper });
    await waitFor(() => expect(hls.FakeHls.latest?.attachMedia).toHaveBeenCalled());

    act(() => hls.FakeHls.latest?.emit('hlsError', { fatal: true, details: 'manifestLoadError' }));

    expect(await screen.findByText('ไม่พบสัญญาณ')).toBeInTheDocument();
    expect(screen.queryByText(/manifestLoadError/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));

    await waitFor(() => expect(streamingApi.stopLive).toHaveBeenCalledWith(SESSION.sessionToken));
    await waitFor(() => expect(streamingApi.startLive).toHaveBeenCalledTimes(2));
  });

  it('compact: ไม่แสดงแถบโควตา คำเตือน audit และ idle hint และไม่ยิง /streams/sessions เอง', async () => {
    render(<StreamPlayer device={DEVICE} compact />, { wrapper });

    await screen.findByLabelText('ภาพสดจากกล้อง');

    expect(screen.queryByText('การรับชมนี้ถูกบันทึกในบันทึกตรวจสอบ')).toBeNull();
    expect(screen.queryByText(/เปิดดูอยู่/)).toBeNull();
    expect(screen.queryByText(/ระบบจะปิดจอให้เอง/)).toBeNull();
    expect(streamingApi.mySessions).not.toHaveBeenCalled();
  });

  it('**สลับกล้องตอนโควตาเต็ม: จอใหม่รอ stop ของจอเดิมก่อนขอภาพ** ไม่งั้นได้ 429', async () => {
    let finishStop: () => void = () => undefined;
    vi.mocked(streamingApi.stopLive).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStop = () => resolve(undefined as never);
        }),
    );

    const first = render(<StreamPlayer device={DEVICE} compact />, { wrapper });
    await first.findByLabelText('ภาพสดจากกล้อง');
    first.unmount();
    expect(streamingApi.stopLive).toHaveBeenCalledWith(SESSION.sessionToken);

    render(<StreamPlayer device={{ ...DEVICE, deviceCode: '1000057' }} compact />, { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(streamingApi.startLive).toHaveBeenCalledTimes(1);

    finishStop();
    await waitFor(() =>
      expect(streamingApi.startLive).toHaveBeenLastCalledWith({ DeviceCode: '1000057' }),
    );
    // ค้างไว้ = stop ตอน cleanup ของเทสต์นี้ค้างในคิวที่ใช้ร่วมทั้งไฟล์ และหน่วงเทสต์ถัดไป
    vi.mocked(streamingApi.stopLive).mockResolvedValue(undefined as never);
  });

  it('**ปิดแท็บ/รีโหลด: ส่ง stop ด้วย keepalive fetch** แล้วไม่ stop ซ้ำตอน unmount', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: 'access-1' });
    try {
      const { unmount } = renderPlayer();
      await screen.findByLabelText('ภาพสดจากกล้อง');

      window.dispatchEvent(new Event('pagehide'));

      expect(fetchMock).toHaveBeenCalledWith(
        `/api/streams/${SESSION.sessionToken}/stop`,
        expect.objectContaining({ method: 'POST', keepalive: true }),
      );
      unmount();
      expect(streamingApi.stopLive).not.toHaveBeenCalled();
    } finally {
      useAuthStore.setState({ accessToken: null });
    }
  });
});

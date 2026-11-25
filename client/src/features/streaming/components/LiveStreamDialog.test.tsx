import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTalkAudio } from '@/features/talk/audio/talkAudio';
import { talkApi, type TalkStartResponse } from '@/features/talk/talk.api';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { signIn } from '@/test/renderPage';
import { deferred } from '@/test/deferred';
import {
  fakeTalkAudio,
  FakeWebSocket,
  installFakeMicrophone,
  removeFakeMicrophone,
} from '@/test/talkFakes';
import { STREAM_END_REASON, STREAM_STATUS, streamingApi, type LiveSession } from '../streaming.api';
import { LiveStreamDialog } from './LiveStreamDialog';

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

vi.mock('@/providers/RealtimeProvider', () => ({ useRealtime: () => realtime.value }));

vi.mock('hls.js', () => ({
  default: { isSupported: () => false, Events: { ERROR: 'hlsError' } },
}));

vi.mock('../streaming.api', async () => {
  const actual = await vi.importActual<typeof import('../streaming.api')>('../streaming.api');
  return {
    ...actual,
    streamingApi: {
      startLive: vi.fn(),
      stopLive: vi.fn(),
      mySessions: vi.fn(),
    },
  };
});

vi.mock('@/features/talk/audio/talkAudio', () => ({ createTalkAudio: vi.fn() }));

vi.mock('@/features/talk/talk.api', async () => {
  const actual = await vi.importActual<typeof import('@/features/talk/talk.api')>(
    '@/features/talk/talk.api',
  );
  return {
    ...actual,
    talkApi: { start: vi.fn(), stop: vi.fn(), stopOnUnload: vi.fn() },
  };
});

const SESSION: LiveSession = {
  sessionToken: 'tok-live',
  protocol: 1,
  device: { id: 'd1', deviceCode: 'BC-001', deviceName: 'หน่วยลาดตระเวน 1' },
  channel: 1,
  playbackUrl: '/api/streams/tok-live/playlist.m3u8?s=sealed',
  idleTimeoutSeconds: 300,
};

const TALK: TalkStartResponse = {
  talkSessionId: '77',
  wsUrl: '/api/talk/ws?ticket=abc',
  uplinkSampleRate: 8000,
  downlinkSampleRate: 8000,
  frameMs: 40,
  maxSeconds: 600,
};

const DEVICE = { deviceCode: 'BC-001', deviceName: 'หน่วยลาดตระเวน 1', onlineStatus: 1 };

function Harness() {
  const [open, setOpen] = useState(true);
  return open ? (
    <LiveStreamDialog device={DEVICE} onClose={() => setOpen(false)} />
  ) : null;
}

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <Harness />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

/** เปิดสายจนได้ ready */
async function startCall() {
  const video = await screen.findByLabelText<HTMLVideoElement>('ภาพสดจากกล้อง');
  fireEvent.loadedData(video);
  const button = await screen.findByRole('button', { name: 'เริ่มการสนทนา' });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  act(() => FakeWebSocket.latest().ready());
  await screen.findByRole('button', { name: 'จบการสนทนา' });
}

beforeEach(() => {
  vi.resetAllMocks();
  realtime.listeners.clear();
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('AudioWorkletNode', class {});
  installFakeMicrophone();
  vi.mocked(createTalkAudio).mockReturnValue(fakeTalkAudio());
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.mocked(streamingApi.startLive).mockResolvedValue(SESSION);
  vi.mocked(streamingApi.stopLive).mockResolvedValue({ success: true });
  vi.mocked(streamingApi.mySessions).mockResolvedValue({ data: [], limit: 4 });
  vi.mocked(talkApi.start).mockResolvedValue(TALK);
  vi.mocked(talkApi.stop).mockResolvedValue({
    talkSessionId: '77',
    status: 3,
    endReason: 1,
    durationSeconds: 3,
  });
  signIn(['streaming:view-live', 'streaming:talk']);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  removeFakeMicrophone();
});

describe('LiveStreamDialog — คุยผ่านกล้อง', () => {
  it('dialog ภาพสดกว้างได้ถึง 67rem และยังเว้นขอบ viewport บนจอ sm ขึ้นไป', () => {
    renderDialog();

    expect(screen.getByRole('dialog')).toHaveClass(
      'sm:w-[calc(100%-2rem)]',
      'sm:max-w-[67rem]',
    );
  });

  it('dialog ภาพสดยังเลื่อนแนวตั้งได้เมื่อความสูง viewport ไม่พอ', () => {
    renderDialog();

    expect(screen.getByRole('dialog')).toHaveClass('overflow-x-hidden', 'overflow-y-auto');
    expect(screen.getByRole('dialog')).not.toHaveClass('overflow-hidden');
  });

  it('**ปุ่มคุยอยู่ซ้ายของ footer (ปิดจออยู่ขวา)** · รอเฟรมแรกของภาพสดก่อน แล้วจึงกดได้', async () => {
    const live = deferred<LiveSession>();
    vi.mocked(streamingApi.startLive).mockReturnValue(live.promise);
    renderDialog();

    const talkButton = screen.getByRole('button', { name: 'เริ่มการสนทนา' });
    expect(talkButton).toBeDisabled();
    expect(talkButton).toHaveAccessibleDescription('รอภาพสดเชื่อมต่อก่อน');

    const close = screen.getByRole('button', { name: 'ปิดจอ' });
    const footer = close.parentElement as HTMLElement;
    expect(footer.firstElementChild).toContainElement(talkButton);
    expect(footer.lastElementChild).toBe(close);

    act(() => live.resolve(SESSION));

    const video = await screen.findByLabelText<HTMLVideoElement>('ภาพสดจากกล้อง');
    expect(talkButton).toBeDisabled();
    expect(talkButton).toHaveAccessibleDescription('รอภาพสดเชื่อมต่อก่อน');

    fireEvent.loadedData(video);
    await waitFor(() => expect(talkButton).toBeEnabled());
    expect(talkButton).toHaveAccessibleDescription('แนะนำให้ใช้หูฟังเพื่อป้องกันเสียงสะท้อน');
  });

  it('ไม่มีสิทธิ์ streaming:talk → ไม่แสดงส่วนคุยผ่านกล้อง · ปุ่มปิดจอยังอยู่', async () => {
    signIn(['streaming:view-live']);
    renderDialog();
    await screen.findByLabelText('ภาพสดจากกล้อง');

    expect(screen.queryByRole('button', { name: 'เริ่มการสนทนา' })).toBeNull();
    expect(screen.getByRole('button', { name: 'ปิดจอ' })).toBeInTheDocument();
  });

  it('ไม่ใช่ secure context → disable "เบราว์เซอร์นี้ใช้ไมโครโฟนไม่ได้"', async () => {
    vi.stubGlobal('isSecureContext', false);
    renderDialog();
    await screen.findByLabelText('ภาพสดจากกล้อง');

    expect(screen.getByRole('button', { name: 'เริ่มการสนทนา' })).toHaveAccessibleDescription(
      'เบราว์เซอร์นี้ใช้ไมโครโฟนไม่ได้',
    );
  });

  it('**ระหว่างคุยวิดีโอถูกบังคับ mute** — กด unmute ก็ถูก mute กลับ · วางสายแล้วปล่อย', async () => {
    renderDialog();
    const video = await screen.findByLabelText<HTMLVideoElement>('ภาพสดจากกล้อง');
    await startCall();

    video.muted = false;
    fireEvent(video, new Event('volumechange'));
    expect(video.muted).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'จบการสนทนา' }));
    await screen.findByText('จบการสนทนาแล้ว');
    expect(screen.getByRole('button', { name: 'เริ่มการสนทนา' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'ลองใหม่' })).toBeNull();

    video.muted = false;
    fireEvent(video, new Event('volumechange'));
    expect(video.muted).toBe(false);
  });

  it('**server ปิดภาพสด (stream:status ENDED) ระหว่างคุย → วางสายทันที** และปุ่มเริ่มการสนทนารอภาพสด', async () => {
    renderDialog();
    await startCall();

    act(() =>
      realtime.listeners.get('stream:status')?.({
        sessionToken: 'tok-live',
        deviceId: 'd1',
        status: STREAM_STATUS.ENDED,
        endReason: STREAM_END_REASON.POLICY_DISABLED,
      }),
    );

    await screen.findByText('สายถูกตัดเนื่องจากสิทธิ์หรือสถานะอุปกรณ์เปลี่ยน');
    expect(talkApi.stop).toHaveBeenCalledWith('77');
    expect(FakeWebSocket.latest().close).toHaveBeenCalledWith(1000);
    const talkButton = screen.getByRole('button', { name: 'เริ่มการสนทนา' });
    expect(talkButton).toBeDisabled();
    expect(talkButton).toHaveAccessibleDescription(/รอภาพสดเชื่อมต่อก่อน/);
  });

  it('**ปิด dialog ระหว่างคุย → stop แบบ keepalive + ปิด WS 1000** และปิดจอภาพสดตามเดิม', async () => {
    renderDialog();
    await startCall();

    await userEvent.click(screen.getByRole('button', { name: 'ปิดจอ' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(talkApi.stopOnUnload).toHaveBeenCalledWith('77');
    expect(FakeWebSocket.latest().close).toHaveBeenCalledWith(1000);
    expect(streamingApi.stopLive).toHaveBeenCalledWith('tok-live');
  });
});

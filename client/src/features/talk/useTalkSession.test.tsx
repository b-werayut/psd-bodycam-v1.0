import { act, renderHook, waitFor } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deferred } from '@/test/deferred';
import {
  fakeTalkAudio,
  FakeWebSocket,
  installFakeMicrophone,
  pcmFrame,
  removeFakeMicrophone,
  type FakeMicrophone,
  type FakeTalkAudio,
} from '@/test/talkFakes';
import { createTalkAudio } from './audio/talkAudio';
import { talkApi, type TalkStartResponse, type TalkStopResponse } from './talk.api';
import { TALK_READY_TIMEOUT_MS, useTalkSession } from './useTalkSession';

vi.mock('./audio/talkAudio', () => ({ createTalkAudio: vi.fn() }));

vi.mock('./talk.api', async () => {
  const actual = await vi.importActual<typeof import('./talk.api')>('./talk.api');
  return {
    ...actual,
    talkApi: { start: vi.fn(), stop: vi.fn(), stopOnUnload: vi.fn() },
  };
});

const SESSION: TalkStartResponse = {
  talkSessionId: '77',
  wsUrl: '/api/talk/ws?ticket=abc',
  uplinkSampleRate: 8000,
  downlinkSampleRate: 8000,
  frameMs: 40,
  maxSeconds: 600,
};

const STOPPED: TalkStopResponse = {
  talkSessionId: '77',
  status: 3,
  endReason: 1,
  durationSeconds: 9,
};

/** 8000 Hz × 40ms × 2 byte */
const FRAME_BYTES = 640;

let audio: FakeTalkAudio;
let mic: FakeMicrophone;

beforeEach(() => {
  vi.resetAllMocks();
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  audio = fakeTalkAudio();
  vi.mocked(createTalkAudio).mockReturnValue(audio);
  mic = installFakeMicrophone();
  vi.mocked(talkApi.start).mockResolvedValue(SESSION);
  vi.mocked(talkApi.stop).mockResolvedValue(STOPPED);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  removeFakeMicrophone();
});

function apiFailure(status: number, code: string): AxiosError {
  const failure = new AxiosError('Request failed', 'ERR_BAD_REQUEST');
  failure.response = {
    data: { statusCode: status, code, message: 'อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่ (สมชาย ใจดี)' },
    status,
    statusText: 'x',
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return failure;
}

function renderTalk(token: string | null = 'live-1') {
  return renderHook(({ token: current }) => useTalkSession(current), {
    initialProps: { token },
  });
}

/** กดเริ่มแล้วรอจน WS ถูกเปิด (ยังไม่ ready) */
async function connect() {
  const hook = renderTalk();
  act(() => hook.result.current.start());
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  return { hook, socket: FakeWebSocket.latest() };
}

/** เชื่อมต่อจน server ส่ง ready = กำลังคุย */
async function talk() {
  const connected = await connect();
  act(() => connected.socket.ready());
  expect(connected.hook.result.current.state).toBe('active');
  return connected;
}

describe('useTalkSession — เริ่มสาย', () => {
  it('เริ่มที่ idle ยังไม่แตะไมค์', () => {
    const { result } = renderTalk();

    expect(result.current.state).toBe('idle');
    expect(result.current.notice).toBeNull();
    expect(mic.getUserMedia).not.toHaveBeenCalled();
  });

  it('**สร้าง AudioContext ทันทีตอนกด** แล้วขอไมค์ด้วย constraint ตาม spec → connecting → POST start ด้วย sessionToken ของภาพสด', async () => {
    const permission = deferred<MediaStream>();
    mic.getUserMedia.mockReturnValue(permission.promise);
    const pendingStart = deferred<TalkStartResponse>();
    vi.mocked(talkApi.start).mockReturnValue(pendingStart.promise);
    const { result } = renderTalk();

    act(() => result.current.start());

    expect(createTalkAudio).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('requesting-mic');
    expect(mic.getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    expect(talkApi.start).not.toHaveBeenCalled();

    act(() => permission.resolve(mic.stream));

    await waitFor(() => expect(result.current.state).toBe('connecting'));
    expect(talkApi.start).toHaveBeenCalledWith('live-1');
  });

  it('POST สำเร็จ → ต่อเสียงด้วย sample rate และขนาด frame จาก server → เปิด WS ตาม wsUrl (binary = ArrayBuffer)', async () => {
    const { hook, socket } = await connect();

    expect(audio.connect).toHaveBeenCalledWith(
      mic.stream,
      expect.objectContaining({ uplinkSampleRate: 8000, downlinkSampleRate: 8000, frameSamples: 320 }),
    );
    expect(socket.url).toBe('ws://localhost:3000/api/talk/ws?ticket=abc');
    expect(socket.binaryType).toBe('arraybuffer');
    expect(hook.result.current.state).toBe('connecting');
    expect(hook.result.current.maxSeconds).toBe(600);
  });

  it('ไม่มี live session → กดเริ่มไม่มีผล', () => {
    const { result } = renderTalk(null);

    act(() => result.current.start());

    expect(result.current.state).toBe('idle');
    expect(createTalkAudio).not.toHaveBeenCalled();
    expect(mic.getUserMedia).not.toHaveBeenCalled();
  });
});

describe('useTalkSession — ระหว่างคุย', () => {
  it('**ยังไม่ได้ ready ห้ามส่งเสียง** — frame ที่มาก่อนถูกทิ้ง', async () => {
    const { hook, socket } = await connect();
    socket.accept();

    act(() => audio.emitFrame(pcmFrame(FRAME_BYTES)));
    expect(socket.send).not.toHaveBeenCalled();
    expect(hook.result.current.state).toBe('connecting');

    act(() => socket.ready());
    act(() => audio.emitFrame(pcmFrame(FRAME_BYTES)));

    expect(hook.result.current.state).toBe('active');
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.send.mock.calls[0][0].byteLength).toBe(640);
  });

  it('**ส่งเฉพาะ frame ที่ยาวพอดี 640 byte** (8 kHz × 40ms) — ขนาดอื่นทิ้ง ไม่ให้ server ตัด 1008', async () => {
    const { socket } = await talk();

    act(() => {
      audio.emitFrame(pcmFrame(638));
      audio.emitFrame(pcmFrame(320));
      audio.emitFrame(pcmFrame(FRAME_BYTES));
    });

    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it('เสียงขาลง (binary) เล่นหลัง ready เท่านั้น · text อื่นไม่นับเป็น ready', async () => {
    const { hook, socket } = await connect();
    socket.accept();

    act(() => {
      socket.receiveBinary(new ArrayBuffer(640));
      socket.receiveText('{"type":"hello"}');
    });
    expect(audio.play).not.toHaveBeenCalled();
    expect(hook.result.current.state).toBe('connecting');

    act(() => socket.ready());
    const downlink = new ArrayBuffer(1024);
    act(() => socket.receiveBinary(downlink));

    expect(audio.play).toHaveBeenCalledWith(downlink);
  });

  it('นับเวลาคุยทุกวินาทีตั้งแต่ ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hook, socket } = await connect();

    act(() => socket.ready());
    act(() => {
      vi.advanceTimersByTime(42_000);
    });

    expect(hook.result.current.elapsedSeconds).toBe(42);
  });

  it('**ปิดไมค์ = track.enabled false** แต่ frame เงียบยังส่งต่อ — DSS จึงไม่ตัดสายเพราะไม่มีเสียง', async () => {
    const { hook, socket } = await talk();

    act(() => hook.result.current.toggleMute());
    expect(mic.track.enabled).toBe(false);
    expect(hook.result.current.muted).toBe(true);

    const silent = [pcmFrame(FRAME_BYTES, 0), pcmFrame(FRAME_BYTES, 0), pcmFrame(FRAME_BYTES, 0)];
    act(() => silent.forEach((frame) => audio.emitFrame(frame)));
    expect(socket.send.mock.calls.map(([data]) => data)).toEqual(silent.map((frame) => frame.bytes));

    act(() => hook.result.current.toggleMute());
    expect(mic.track.enabled).toBe(true);
    expect(hook.result.current.muted).toBe(false);

    act(() => audio.emitFrame(pcmFrame(FRAME_BYTES, 0.5)));
    expect(socket.send).toHaveBeenCalledTimes(4);
  });

  it('แถบระดับเสียงอัปเดตทุก 5 frame ด้วยค่าสูงสุดของช่วงนั้น', async () => {
    const { hook } = await talk();

    act(() => {
      for (const peak of [0.1, 0.6, 0.2, 0.3]) audio.emitFrame(pcmFrame(FRAME_BYTES, peak));
    });
    expect(hook.result.current.micLevel).toBe(0);

    act(() => audio.emitFrame(pcmFrame(FRAME_BYTES, 0.1)));
    expect(hook.result.current.micLevel).toBe(0.6);
  });
});

describe('useTalkSession — วางสาย', () => {
  it('**กดวางสาย: ไมค์ปิดทันที → stop(id) → ปิด WS 1000** แล้วแจ้งว่าจบการสนทนาแล้ว', async () => {
    const stop = deferred<TalkStopResponse>();
    vi.mocked(talkApi.stop).mockReturnValue(stop.promise);
    const { hook, socket } = await talk();

    act(() => hook.result.current.hangUp());

    expect(hook.result.current.state).toBe('ending');
    expect(mic.track.stop).toHaveBeenCalled();
    expect(audio.close).toHaveBeenCalled();
    expect(talkApi.stop).toHaveBeenCalledWith('77');
    expect(socket.close).not.toHaveBeenCalled();

    act(() => stop.resolve(STOPPED));

    await waitFor(() => expect(hook.result.current.state).toBe('ended'));
    expect(socket.close).toHaveBeenCalledWith(1000);
    expect(hook.result.current.notice).toEqual({ key: 'talk.ended.1000' });

    // server ปิดตามด้วย 4004 หลัง REST stop — ต้องไม่ทับข้อความที่ผู้ใช้เลือกเอง
    act(() => socket.serverClose(4004));
    expect(hook.result.current.notice).toEqual({ key: 'talk.ended.1000' });
  });

  it('ยกเลิกระหว่างรอ server ต่อ DSS (~11 วินาที) → สายที่ server เปิดให้ทีหลังถูกสั่ง stop', async () => {
    const pending = deferred<TalkStartResponse>();
    vi.mocked(talkApi.start).mockReturnValue(pending.promise);
    const { result } = renderTalk();
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe('connecting'));

    act(() => result.current.hangUp());

    await waitFor(() => expect(result.current.state).toBe('ended'));
    expect(mic.track.stop).toHaveBeenCalled();

    act(() => pending.resolve(SESSION));

    await waitFor(() => expect(talkApi.stop).toHaveBeenCalledWith('77'));
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});

describe('useTalkSession — server ปิดสาย', () => {
  it.each([
    [4001, { key: 'talk.ended.4001', params: { n: '10' } }],
    [4002, { key: 'talk.ended.4002' }],
    [4003, { key: 'talk.ended.4003' }],
    [4005, { key: 'talk.ended.4005' }],
    [4006, { key: 'talk.ended.4006' }],
    [1008, { key: 'talk.ended.1008' }],
  ])('close %i ระหว่างคุย → ended พร้อมข้อความของ code นั้น · ไม่ยิง REST ซ้ำ', async (code, notice) => {
    const { hook, socket } = await talk();

    act(() => socket.serverClose(code));

    expect(hook.result.current.state).toBe('ended');
    expect(hook.result.current.notice).toEqual(notice);
    expect(mic.track.stop).toHaveBeenCalled();
    expect(audio.close).toHaveBeenCalled();
    expect(talkApi.stop).not.toHaveBeenCalled();
  });

  it('ปิดก่อน ready (ticket หมดอายุ 4401) → error "หมดเวลาเชื่อมต่อ"', async () => {
    const { hook, socket } = await connect();

    act(() => socket.serverClose(4401));

    expect(hook.result.current.state).toBe('error');
    expect(hook.result.current.notice).toEqual({ key: 'talk.ended.4401' });
    // the server row may still be ACTIVE (e.g. a DB error while consuming the ticket): stop it over REST
    expect(talkApi.stop).toHaveBeenCalledWith('77');
  });

  it('เน็ตหลุด (1006) → สายหลุด และสั่ง stop ผ่าน REST เผื่อ server ยังไม่รู้', async () => {
    const { hook, socket } = await talk();

    act(() => socket.serverClose(1006));

    expect(hook.result.current.notice).toEqual({ key: 'talk.ended.1006' });
    expect(talkApi.stop).toHaveBeenCalledWith('77');
  });

  it('**server ไม่ส่ง ready ภายใน 30 วินาที** → error หมดเวลา · สั่ง stop · ปิด WS', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hook, socket } = await connect();
    socket.accept();

    act(() => {
      vi.advanceTimersByTime(TALK_READY_TIMEOUT_MS - 1_000);
    });
    expect(hook.result.current.state).toBe('connecting');

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(TALK_READY_TIMEOUT_MS).toBe(30_000);
    expect(hook.result.current.state).toBe('error');
    expect(hook.result.current.notice).toEqual({ key: 'talk.error.timeout' });
    expect(talkApi.stop).toHaveBeenCalledWith('77');
    expect(socket.close).toHaveBeenCalledWith(1000);
  });
});

describe('useTalkSession — เริ่มไม่สำเร็จ', () => {
  it.each([
    ['NotAllowedError', 'talk.mic.notAllowed'],
    ['NotFoundError', 'talk.mic.notFound'],
    ['NotReadableError', 'talk.mic.notReadable'],
  ])('ไมค์ %s → error ตาม spec · ไม่เรียก POST start · ปิด AudioContext', async (name, key) => {
    mic.getUserMedia.mockRejectedValue(new DOMException('mic', name));
    const { result } = renderTalk();

    act(() => result.current.start());

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.notice).toEqual({ key });
    expect(talkApi.start).not.toHaveBeenCalled();
    expect(audio.close).toHaveBeenCalled();
  });

  it('**POST start ไม่ผ่าน → ข้อความไทยจาก backend ตรง ๆ** และปิดไมค์', async () => {
    const failure = new AxiosError('Request failed', 'ERR_BAD_REQUEST');
    failure.response = {
      data: { message: 'อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่ (สมชาย ใจดี)' },
      status: 409,
      statusText: 'Conflict',
      headers: {},
      config: { headers: new AxiosHeaders() },
    };
    vi.mocked(talkApi.start).mockRejectedValue(failure);
    const { result } = renderTalk();

    act(() => result.current.start());

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.notice).toEqual({
      text: 'อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่ (สมชาย ใจดี)',
    });
    expect(mic.track.stop).toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('409 TALK_DEVICE_BUSY → shows the server message and state returns to idle', async () => {
    vi.mocked(talkApi.start).mockRejectedValue(apiFailure(409, 'TALK_DEVICE_BUSY'));
    const { result } = renderTalk();

    act(() => result.current.start());

    await waitFor(() => expect(result.current.state).toBe('idle'));
    expect(result.current.notice).toEqual({ text: 'อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่ (สมชาย ใจดี)' });
    expect(mic.track.stop).toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
    // กดเริ่มใหม่ได้
    act(() => result.current.start());
    expect(result.current.state).toBe('requesting-mic');
  });

  it.each(['TALK_USER_BUSY', 'TALK_ALREADY_STARTING'])('409 %s → idle', async (code) => {
    vi.mocked(talkApi.start).mockRejectedValue(apiFailure(409, code));
    const { result } = renderTalk();

    act(() => result.current.start());

    await waitFor(() => expect(result.current.state).toBe('idle'));
    expect(result.current.notice).toEqual({ text: 'อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่ (สมชาย ใจดี)' });
  });

  it('other 409 / 502 → error (not idle)', async () => {
    vi.mocked(talkApi.start).mockRejectedValue(apiFailure(502, 'TALK_START_FAILED'));
    const { result } = renderTalk();

    act(() => result.current.start());

    await waitFor(() => expect(result.current.state).toBe('error'));
  });

  it('microphone denied → notice talk.mic.notAllowed and no open server call', async () => {
    mic.getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const { result } = renderTalk();

    act(() => result.current.start());

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.notice).toEqual({ key: 'talk.mic.notAllowed' });
    expect(talkApi.start).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('POST start ไม่ตอบใน 30 วินาที (axios timeout) → หมดเวลาเชื่อมต่อ', async () => {
    vi.mocked(talkApi.start).mockRejectedValue(
      new AxiosError('timeout of 30000ms exceeded', AxiosError.ECONNABORTED),
    );
    const { result } = renderTalk();

    act(() => result.current.start());

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.notice).toEqual({ key: 'talk.error.timeout' });
  });

  it('โหลดระบบเสียงไม่สำเร็จ → error และสั่ง stop สายที่ server เปิดไว้แล้ว', async () => {
    audio.connect.mockRejectedValue(new Error('addModule failed'));
    const { result } = renderTalk();

    act(() => result.current.start());

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.notice).toEqual({ key: 'talk.error.audio' });
    expect(talkApi.stop).toHaveBeenCalledWith('77');
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});

describe('useTalkSession — live session หาย · ปิด dialog · ปิดหน้า', () => {
  it('**live session หาย (token → null) ระหว่างคุย → วางสายทันที** stop + ปิด 1000 + ข้อความ 4006', async () => {
    const { hook, socket } = await talk();

    hook.rerender({ token: null });

    await waitFor(() => expect(hook.result.current.state).toBe('ended'));
    expect(talkApi.stop).toHaveBeenCalledWith('77');
    expect(socket.close).toHaveBeenCalledWith(1000);
    expect(hook.result.current.notice).toEqual({ key: 'talk.ended.4006' });
  });

  it('**dialog unmount ระหว่างคุย → stopOnUnload (keepalive) + ปิด WS 1000** ไม่ใช้ axios', async () => {
    const { hook, socket } = await talk();

    hook.unmount();

    expect(talkApi.stopOnUnload).toHaveBeenCalledWith('77');
    expect(talkApi.stop).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(1000);
    expect(mic.track.stop).toHaveBeenCalled();
    expect(audio.close).toHaveBeenCalled();
  });

  it('pagehide ระหว่างคุย → เหมือน unmount และแสดงว่าจบการสนทนาแล้ว', async () => {
    const { hook, socket } = await talk();

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(talkApi.stopOnUnload).toHaveBeenCalledWith('77');
    expect(socket.close).toHaveBeenCalledWith(1000);
    expect(hook.result.current.state).toBe('ended');
    expect(hook.result.current.notice).toEqual({ key: 'talk.ended.1000' });
  });

  it('ปิด dialog ระหว่างรอ POST start → สายที่ server เปิดให้ทีหลังถูกสั่ง stop และไม่เปิด WS', async () => {
    const pending = deferred<TalkStartResponse>();
    vi.mocked(talkApi.start).mockReturnValue(pending.promise);
    const { result, unmount } = renderTalk();
    act(() => result.current.start());
    await waitFor(() => expect(talkApi.start).toHaveBeenCalled());

    unmount();
    pending.resolve(SESSION);

    await waitFor(() => expect(talkApi.stop).toHaveBeenCalledWith('77'));
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('unmount while start is pending → stops that call when start resolves and never opens a WebSocket', async () => {
    const start = deferred<TalkStartResponse>();
    vi.mocked(talkApi.start).mockReturnValue(start.promise);
    const { result, unmount } = renderTalk();
    act(() => void result.current.start());
    await waitFor(() => expect(talkApi.start).toHaveBeenCalled());
    unmount();
    start.resolve(SESSION);

    await waitFor(() => expect(talkApi.stop).toHaveBeenCalledWith(SESSION.talkSessionId));
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('unmount before the microphone resolves → never calls start at all', async () => {
    const { result, unmount } = renderTalk();
    act(() => void result.current.start());
    unmount();

    await waitFor(() => expect(mic.track.stop).toHaveBeenCalled());
    expect(talkApi.start).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('จบสายแล้วเริ่มใหม่ได้ และเริ่มจากสถานะสะอาด', async () => {
    const { hook, socket } = await talk();
    act(() => hook.result.current.toggleMute());
    act(() => socket.serverClose(4003));

    act(() => hook.result.current.start());

    expect(hook.result.current.state).toBe('requesting-mic');
    expect(hook.result.current.notice).toBeNull();
    expect(hook.result.current.muted).toBe(false);
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
  });
});

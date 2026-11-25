import { vi, type Mock } from 'vitest';

import type { PcmFrame } from '@/features/talk/audio/pcm';
import type { TalkAudio, TalkAudioConfig } from '@/features/talk/audio/talkAudio';

/**
 * WebSocket ปลอม — ใช้กับ `vi.stubGlobal('WebSocket', FakeWebSocket)`
 * `close()` ของเราไม่ยิง onclose (hook ถอด handler ก่อนปิดเองอยู่แล้ว) · ฝั่ง server ปิดใช้ `serverClose()`
 */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  binaryType: BinaryType = 'blob';
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly send = vi.fn<(data: ArrayBuffer) => void>();
  readonly close = vi.fn<(code?: number) => void>(() => {
    this.readyState = FakeWebSocket.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  static latest(): FakeWebSocket {
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (!socket) throw new Error('ยังไม่มี WebSocket ถูกเปิด');
    return socket;
  }

  /** upgrade สำเร็จ แต่ยังไม่ได้ส่ง ready */
  accept(): void {
    this.readyState = FakeWebSocket.OPEN;
  }

  /** server ต่อ FastAPI ติดแล้ว — ส่ง {"type":"ready"} */
  ready(): void {
    this.accept();
    this.receiveText(JSON.stringify({ type: 'ready' }));
  }

  receiveText(text: string): void {
    this.onmessage?.({ data: text } as MessageEvent);
  }

  receiveBinary(bytes: ArrayBuffer): void {
    this.onmessage?.({ data: bytes } as MessageEvent);
  }

  serverClose(code: number): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }
}

export type FakeMicrophone = {
  track: { enabled: boolean; stop: Mock };
  stream: MediaStream;
  getUserMedia: Mock<(constraints: MediaStreamConstraints) => Promise<MediaStream>>;
};

/** ติดตั้ง `navigator.mediaDevices.getUserMedia` ปลอม — jsdom ไม่มี mediaDevices · เอาออกด้วย `removeFakeMicrophone()` */
export function installFakeMicrophone(): FakeMicrophone {
  const track = { enabled: true, stop: vi.fn() };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const getUserMedia = vi
    .fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>()
    .mockResolvedValue(stream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  return { track, stream, getUserMedia };
}

export function removeFakeMicrophone(): void {
  delete (navigator as { mediaDevices?: unknown }).mediaDevices;
}

export type FakeTalkAudio = TalkAudio & {
  connect: Mock<(stream: MediaStream, config: TalkAudioConfig) => Promise<void>>;
  play: Mock<(frame: ArrayBuffer) => void>;
  close: Mock<() => void>;
  config: TalkAudioConfig | null;
  /** จำลอง capture worklet ส่ง frame ขึ้นมา */
  emitFrame(frame: PcmFrame): void;
};

/** แทน `createTalkAudio()` — ใช้คู่กับ `vi.mock('@/features/talk/audio/talkAudio')` */
export function fakeTalkAudio(): FakeTalkAudio {
  const audio: FakeTalkAudio = {
    config: null,
    connect: vi.fn(async (_stream: MediaStream, config: TalkAudioConfig) => {
      audio.config = config;
    }),
    play: vi.fn(),
    close: vi.fn(),
    emitFrame(frame) {
      audio.config?.onFrame(frame);
    },
  };
  return audio;
}

export function pcmFrame(bytes: number, peak = 0.2): PcmFrame {
  return { bytes: new ArrayBuffer(bytes), peak };
}

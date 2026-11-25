import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PcmFrame } from './pcm';
import { createTalkAudio, UPLINK_LOWPASS_HZ, type TalkAudioConfig } from './talkAudio';

class FakeNode {
  readonly connect = vi.fn((next: FakeNode) => next);
  readonly disconnect = vi.fn();
}

class FakeBiquadFilterNode extends FakeNode {
  static instances: FakeBiquadFilterNode[] = [];

  constructor(
    readonly context: unknown,
    readonly options: BiquadFilterOptions,
  ) {
    super();
    FakeBiquadFilterNode.instances.push(this);
  }
}

class FakeAudioWorkletNode extends FakeNode {
  static instances: FakeAudioWorkletNode[] = [];
  readonly port = {
    postMessage: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
  };

  constructor(
    readonly context: unknown,
    readonly name: string,
    readonly options: AudioWorkletNodeOptions,
  ) {
    super();
    FakeAudioWorkletNode.instances.push(this);
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = 'suspended';
  readonly destination = new FakeNode();
  readonly microphone = new FakeNode();
  readonly audioWorklet = { addModule: vi.fn<(url: string) => Promise<void>>(async () => undefined) };
  readonly createMediaStreamSource = vi.fn(() => this.microphone);
  readonly resume = vi.fn(async () => {
    this.state = 'running';
  });
  readonly close = vi.fn(async () => undefined);

  constructor(readonly options?: AudioContextOptions) {
    FakeAudioContext.instances.push(this);
  }
}

const stream = {} as MediaStream;

function config(onFrame = vi.fn<(frame: PcmFrame) => void>()): TalkAudioConfig {
  return { uplinkSampleRate: 8000, downlinkSampleRate: 8000, frameSamples: 320, onFrame };
}

const workletNamed = (name: string) =>
  FakeAudioWorkletNode.instances.find((node) => node.name === name);

beforeEach(() => {
  FakeAudioContext.instances = [];
  FakeAudioWorkletNode.instances = [];
  FakeBiquadFilterNode.instances = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
  vi.stubGlobal('BiquadFilterNode', FakeBiquadFilterNode);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createTalkAudio', () => {
  it('**สร้าง AudioContext ทันที และไม่กำหนด sampleRate** (Firefox ต่อไมค์เข้า context ต่าง rate ไม่ได้)', () => {
    createTalkAudio();

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].options).toEqual({ latencyHint: 'interactive' });
  });

  it('ต่อ graph: ไมค์ → lowpass 3.4 kHz → capture worklet → destination · playback worklet → destination', async () => {
    const audio = createTalkAudio();
    await audio.connect(stream, config());
    const context = FakeAudioContext.instances[0];

    expect(context.audioWorklet.addModule).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('capture.worklet'),
    );
    expect(context.audioWorklet.addModule).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('playback.worklet'),
    );
    expect(context.createMediaStreamSource).toHaveBeenCalledWith(stream);

    const [lowpass] = FakeBiquadFilterNode.instances;
    expect(lowpass.options).toMatchObject({ type: 'lowpass', frequency: UPLINK_LOWPASS_HZ });
    expect(UPLINK_LOWPASS_HZ).toBe(3400);

    const capture = workletNamed('talk-capture');
    const playback = workletNamed('talk-playback');
    expect(capture?.options.processorOptions).toEqual({ targetRate: 8000, frameSamples: 320 });
    expect(playback?.options.processorOptions).toEqual({ sourceRate: 8000 });

    expect(context.microphone.connect).toHaveBeenCalledWith(lowpass);
    expect(lowpass.connect).toHaveBeenCalledWith(capture);
    expect(capture?.connect).toHaveBeenCalledWith(context.destination);
    expect(playback?.connect).toHaveBeenCalledWith(context.destination);
    expect(context.resume).toHaveBeenCalled();
  });

  it('frame จาก capture worklet ส่งต่อให้ onFrame', async () => {
    const onFrame = vi.fn<(frame: PcmFrame) => void>();
    const audio = createTalkAudio();
    await audio.connect(stream, config(onFrame));
    const frame: PcmFrame = { bytes: new ArrayBuffer(640), peak: 0.4 };

    workletNamed('talk-capture')?.port.onmessage?.({ data: frame } as MessageEvent<PcmFrame>);

    expect(onFrame).toHaveBeenCalledWith(frame);
  });

  it('play ส่ง frame ขาลงเข้า playback worklet แบบ transfer', async () => {
    const audio = createTalkAudio();
    await audio.connect(stream, config());
    const bytes = new ArrayBuffer(640);

    audio.play(bytes);

    expect(workletNamed('talk-playback')?.port.postMessage).toHaveBeenCalledWith(bytes, [bytes]);
  });

  it('close ปลดทุก node และปิด context ครั้งเดียวแม้เรียกซ้ำ', async () => {
    const audio = createTalkAudio();
    await audio.connect(stream, config());
    const context = FakeAudioContext.instances[0];

    audio.close();
    audio.close();

    expect(context.close).toHaveBeenCalledTimes(1);
    expect(context.microphone.disconnect).toHaveBeenCalled();
    expect(workletNamed('talk-capture')?.disconnect).toHaveBeenCalled();
    expect(workletNamed('talk-playback')?.disconnect).toHaveBeenCalled();
    expect(workletNamed('talk-capture')?.port.onmessage).toBeNull();
  });

  it('**close ระหว่างโหลด worklet -> ไม่สร้าง node ต่อ** (ผู้ใช้วางสาย/ปิดจอก่อนเสียงพร้อม)', async () => {
    const audio = createTalkAudio();
    const context = FakeAudioContext.instances[0];
    let finishLoading: () => void = () => undefined;
    context.audioWorklet.addModule.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => {
        finishLoading = () => resolve(undefined);
      }),
    );

    const connecting = audio.connect(stream, config());
    audio.close();
    finishLoading();
    await connecting;

    expect(FakeAudioWorkletNode.instances).toHaveLength(0);
    expect(context.createMediaStreamSource).not.toHaveBeenCalled();
  });
});

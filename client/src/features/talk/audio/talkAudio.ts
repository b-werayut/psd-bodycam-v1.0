import captureWorkletUrl from './capture.worklet.ts?worker&url';
import playbackWorkletUrl from './playback.worklet.ts?worker&url';
import type { PcmFrame } from './pcm';
import {
  TALK_PROCESSOR,
  type CaptureProcessorOptions,
  type PlaybackProcessorOptions,
} from './workletProtocol';

/** ตัดเสียงเหนือ 3.4 kHz ก่อนลดเป็น 8 kHz (Nyquist 4 kHz) กัน aliasing */
export const UPLINK_LOWPASS_HZ = 3400;

export type TalkAudioConfig = {
  uplinkSampleRate: number;
  downlinkSampleRate: number;
  frameSamples: number;
  onFrame: (frame: PcmFrame) => void;
};

/**
 * ทุกอย่างที่แตะ Web Audio อยู่หลัง interface นี้ — `useTalkSession` ใช้ผ่าน `createTalkAudio()`
 * และเทสต์ของ hook / dialog mock โมดูลนี้ทั้งโมดูล (jsdom ไม่มี AudioContext)
 */
export type TalkAudio = {
  /** โหลด worklet 2 ตัวแล้วต่อ graph: ไมค์ → lowpass → capture → (เงียบ) destination · playback → destination */
  connect(stream: MediaStream, config: TalkAudioConfig): Promise<void>;
  /** frame PCM16LE ขาลงจาก WS — ส่งเข้า playback worklet แบบ transfer */
  play(frame: ArrayBuffer): void;
  /** ปลดทุก node และปิด AudioContext — เรียกซ้ำได้ */
  close(): void;
};

/**
 * สร้าง AudioContext **ทันทีที่เรียก** (ผู้เรียกต้องเรียกใน click handler — Safari ไม่ยอมให้
 * context ที่สร้างหลัง await ออกเสียง) · **ไม่กำหนด sampleRate** ให้ใช้ rate ของอุปกรณ์ เพราะ
 * Firefox ต่อไมค์เข้า context ที่ rate ต่างจากไมค์ไม่ได้ — แปลง rate เองใน worklet แทน
 */
export function createTalkAudio(): TalkAudio {
  const context = new AudioContext({ latencyHint: 'interactive' });
  let source: MediaStreamAudioSourceNode | null = null;
  let lowpass: BiquadFilterNode | null = null;
  let capture: AudioWorkletNode | null = null;
  let playback: AudioWorkletNode | null = null;
  let closed = false;

  return {
    async connect(stream, config) {
      await context.audioWorklet.addModule(captureWorkletUrl);
      await context.audioWorklet.addModule(playbackWorkletUrl);
      if (closed) return;

      const captureOptions: CaptureProcessorOptions = {
        targetRate: config.uplinkSampleRate,
        frameSamples: config.frameSamples,
      };
      source = context.createMediaStreamSource(stream);
      lowpass = new BiquadFilterNode(context, {
        type: 'lowpass',
        frequency: UPLINK_LOWPASS_HZ,
        Q: Math.SQRT1_2,
      });
      capture = new AudioWorkletNode(context, TALK_PROCESSOR.capture, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: captureOptions,
      });
      capture.port.onmessage = (event: MessageEvent<PcmFrame>) => config.onFrame(event.data);
      // capture ออกเงียบเสมอ — ต่อเข้า destination เพื่อให้ browser ดึง process() ตลอดเวลา
      source.connect(lowpass).connect(capture).connect(context.destination);

      const playbackOptions: PlaybackProcessorOptions = { sourceRate: config.downlinkSampleRate };
      playback = new AudioWorkletNode(context, TALK_PROCESSOR.playback, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: playbackOptions,
      });
      playback.connect(context.destination);

      if (context.state === 'suspended') await context.resume();
    },

    play(frame) {
      playback?.port.postMessage(frame, [frame]);
    },

    close() {
      if (closed) return;
      closed = true;
      if (capture) capture.port.onmessage = null;
      source?.disconnect();
      lowpass?.disconnect();
      capture?.disconnect();
      playback?.disconnect();
      void context.close().catch(() => undefined);
    },
  };
}

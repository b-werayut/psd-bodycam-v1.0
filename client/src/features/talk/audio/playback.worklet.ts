/**
 * AudioWorkletProcessor ขาลง — frame PCM16LE จาก WS (main thread ส่งผ่าน port แบบ transfer)
 * → jitter buffer (สะสม 80ms · เก็บไม่เกิน 300ms · ขาด = เงียบแล้วสะสมใหม่) → แปลงเป็น rate ของ
 * AudioContext → ลำโพง · ตรรกะทั้งหมดอยู่ใน `DownlinkPlayer` (pure) ไฟล์นี้เป็นแค่ตัวเชื่อม
 *
 * รันใน AudioWorkletGlobalScope — `talkAudio.ts` โหลดผ่าน `?worker&url` · ห้าม import ไฟล์นี้จาก main thread
 */
import { DownlinkPlayer } from './downlink';
import { TALK_PROCESSOR, type PlaybackProcessorOptions } from './workletProtocol';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(
  name: string,
  processorCtor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

class TalkPlaybackProcessor extends AudioWorkletProcessor {
  private readonly player: DownlinkPlayer;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const { sourceRate } = options.processorOptions as PlaybackProcessorOptions;
    this.player = new DownlinkPlayer(sourceRate, sampleRate);
    this.port.onmessage = (event: MessageEvent<ArrayBuffer>) => this.player.push(event.data);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (output && output.length > 0) {
      this.player.render(output[0]);
      for (let channel = 1; channel < output.length; channel += 1) {
        output[channel].set(output[0]);
      }
    }
    // true keeps the processor alive for as long as the node stays connected
    return true;
  }
}

registerProcessor(TALK_PROCESSOR.playback, TalkPlaybackProcessor);

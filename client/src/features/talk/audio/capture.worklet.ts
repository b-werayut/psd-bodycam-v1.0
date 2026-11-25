/**
 * AudioWorkletProcessor ขาขึ้น — ไมค์ (ผ่าน lowpass 3.4 kHz มาแล้ว) → แปลง rate ของ AudioContext
 * เป็น uplinkSampleRate → Int16LE → frame ละ frameSamples ส่งกลับ main thread ทาง port (transfer ไม่ copy)
 *
 * รันใน AudioWorkletGlobalScope — `talkAudio.ts` โหลดผ่าน `?worker&url` ซึ่ง Vite bundle import
 * ของไฟล์นี้ (pcm / resampler) รวมเป็นไฟล์เดียวตอน build · ห้าม import ไฟล์นี้จาก main thread
 */
import { Pcm16Framer } from './pcm';
import { LinearResampler } from './resampler';
import { TALK_PROCESSOR, type CaptureProcessorOptions } from './workletProtocol';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(
  name: string,
  processorCtor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

class TalkCaptureProcessor extends AudioWorkletProcessor {
  private readonly resampler: LinearResampler;
  private readonly framer: Pcm16Framer;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const { targetRate, frameSamples } = options.processorOptions as CaptureProcessorOptions;
    this.resampler = new LinearResampler(sampleRate, targetRate);
    this.framer = new Pcm16Framer(frameSamples);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      for (const frame of this.framer.push(this.resampler.process(channel))) {
        this.port.postMessage(frame, [frame.bytes]);
      }
    }
    // node นี้ต่อเข้า destination เพื่อให้ browser เรียก process() แน่นอน — ต้องออกเงียบเสมอ
    for (const output of outputs) {
      for (const samples of output) samples.fill(0);
    }
    return true;
  }
}

registerProcessor(TALK_PROCESSOR.capture, TalkCaptureProcessor);

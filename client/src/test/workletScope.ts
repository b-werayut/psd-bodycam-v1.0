import { vi, type Mock } from 'vitest';

export type FakePort = {
  postMessage: Mock;
  onmessage: ((event: MessageEvent) => void) | null;
};

export type FakeProcessor = {
  port: FakePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

type ProcessorCtor = new (options: AudioWorkletNodeOptions) => FakeProcessor;

/**
 * จำลอง AudioWorkletGlobalScope (`AudioWorkletProcessor` · `registerProcessor` · `sampleRate`)
 * พอให้ import ไฟล์ `*.worklet.ts` ใน jsdom ได้ — ต้องเรียกก่อน `await import('./x.worklet')`
 * และเรียก `vi.unstubAllGlobals()` ตอนจบไฟล์
 */
export function installWorkletScope(contextRate: number) {
  const registered = new Map<string, ProcessorCtor>();

  class FakeAudioWorkletProcessor {
    readonly port: FakePort = { postMessage: vi.fn(), onmessage: null };
  }

  vi.stubGlobal('AudioWorkletProcessor', FakeAudioWorkletProcessor);
  vi.stubGlobal('registerProcessor', (name: string, ctor: ProcessorCtor) => {
    registered.set(name, ctor);
  });
  vi.stubGlobal('sampleRate', contextRate);

  return {
    registered,
    create(name: string, processorOptions: unknown): FakeProcessor {
      const Processor = registered.get(name);
      if (!Processor) throw new Error(`processor ${name} ยังไม่ได้ลงทะเบียน`);
      return new Processor({ processorOptions });
    },
  };
}

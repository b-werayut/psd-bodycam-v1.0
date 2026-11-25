import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installWorkletScope } from '@/test/workletScope';
import { decodePcm16le, type PcmFrame } from './pcm';
import { TALK_PROCESSOR } from './workletProtocol';

let scope: ReturnType<typeof installWorkletScope>;

beforeAll(async () => {
  scope = installWorkletScope(48000);
  await import('./capture.worklet');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const quantum = (value: number) => new Float32Array(128).fill(value);
const silentOutput = () => [[new Float32Array(128)]];

/** frame 40ms ที่ 8 kHz = 320 sample (ค่าจาก start response: 8000 × 40 / 1000) */
function createCapture() {
  return scope.create(TALK_PROCESSOR.capture, { targetRate: 8000, frameSamples: 320 });
}

describe('capture.worklet', () => {
  it('ลงทะเบียนชื่อ talk-capture', () => {
    expect(scope.registered.has('talk-capture')).toBe(true);
  });

  it('**48 kHz → frame 8 kHz ละ 640 byte พอดี** ส่งแบบ transfer', () => {
    const capture = createCapture();
    // 14 quantum = 1792 sample ที่ 48k → 299 sample ที่ 8k ยังไม่ครบ frame
    for (let i = 0; i < 14; i += 1) capture.process([[quantum(0.5)]], silentOutput());
    expect(capture.port.postMessage).not.toHaveBeenCalled();

    // quantum ที่ 15 = 1920 sample = 40ms พอดี → ครบ 320 sample
    capture.process([[quantum(0.5)]], silentOutput());
    expect(capture.port.postMessage).toHaveBeenCalledTimes(1);
    const [frame, transfer] = capture.port.postMessage.mock.calls[0] as [PcmFrame, ArrayBuffer[]];
    expect(frame.bytes.byteLength).toBe(640);
    expect(transfer).toEqual([frame.bytes]);
    expect(frame.peak).toBeCloseTo(0.5, 3);
    expect(decodePcm16le(frame.bytes)[10]).toBeCloseTo(0.5, 3);
  });

  it('**ปิดไมค์ (track.enabled false = input เป็น 0)** ยังส่ง frame เงียบ 640 byte ทุก 40ms', () => {
    const capture = createCapture();

    // 45 quantum ที่ 48k = 120ms = 3 frame
    for (let i = 0; i < 45; i += 1) capture.process([[quantum(0)]], silentOutput());

    expect(capture.port.postMessage).toHaveBeenCalledTimes(3);
    for (const [frame] of capture.port.postMessage.mock.calls as [PcmFrame, ArrayBuffer[]][]) {
      expect(frame.bytes.byteLength).toBe(640);
      expect(frame.peak).toBe(0);
      expect(decodePcm16le(frame.bytes).every((sample) => sample === 0)).toBe(true);
    }
  });

  it('ไม่มี input (ไมค์ถูกตัดออกจาก graph) -> ไม่ส่งอะไรและ processor ยังทำงานต่อ', () => {
    const capture = createCapture();

    expect(capture.process([[]], silentOutput())).toBe(true);
    expect(capture.process([], silentOutput())).toBe(true);
    expect(capture.port.postMessage).not.toHaveBeenCalled();
  });

  it('**output เงียบเสมอ** — node ต่อเข้า destination แต่ห้ามเล่นเสียงไมค์ตัวเองออกลำโพง', () => {
    const capture = createCapture();
    const output = new Float32Array(128).fill(0.9);

    capture.process([[quantum(0.5)]], [[output]]);

    expect(Array.from(output).every((value) => value === 0)).toBe(true);
  });
});

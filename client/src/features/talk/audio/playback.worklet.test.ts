import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installWorkletScope, type FakeProcessor } from '@/test/workletScope';
import { encodePcm16le } from './pcm';
import { TALK_PROCESSOR } from './workletProtocol';

let scope: ReturnType<typeof installWorkletScope>;

beforeAll(async () => {
  scope = installWorkletScope(48000);
  await import('./playback.worklet');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** frame ขาลง 40ms ที่ 8 kHz = 320 sample = 640 byte */
const downlinkFrame = (value: number) => encodePcm16le(new Float32Array(320).fill(value));

function receive(playback: FakeProcessor, bytes: ArrayBuffer) {
  playback.port.onmessage?.({ data: bytes } as MessageEvent<ArrayBuffer>);
}

function render(playback: FakeProcessor, channels = 1): Float32Array[] {
  const output = Array.from({ length: channels }, () => new Float32Array(128));
  playback.process([], [output]);
  return output;
}

function createPlayback() {
  return scope.create(TALK_PROCESSOR.playback, { sourceRate: 8000 });
}

describe('playback.worklet', () => {
  it('ลงทะเบียนชื่อ talk-playback', () => {
    expect(scope.registered.has('talk-playback')).toBe(true);
  });

  it('frame จาก port เข้า jitter buffer — เงียบจนครบ 80ms แล้วเล่นที่ rate ของ context', () => {
    const playback = createPlayback();
    receive(playback, downlinkFrame(0.25));
    const [waiting] = render(playback);
    expect(Array.from(waiting).every((value) => value === 0)).toBe(true);

    receive(playback, downlinkFrame(0.25));
    render(playback);
    const [played] = render(playback);
    expect(Array.from(played).every((value) => Math.abs(value - 0.25) < 1e-3)).toBe(true);
  });

  it('ส่งเสียงเดียวกันออกทุก channel ของ output', () => {
    const playback = createPlayback();
    for (let i = 0; i < 3; i += 1) receive(playback, downlinkFrame(-0.5));
    render(playback, 2);

    const [left, right] = render(playback, 2);
    expect(Array.from(right)).toEqual(Array.from(left));
    expect(left[0]).toBeCloseTo(-0.5, 3);
  });

  it('ไม่มี output -> ไม่ล้ม', () => {
    const playback = createPlayback();

    expect(playback.process([], [])).toBe(true);
    expect(playback.process([], [[]])).toBe(true);
  });
});

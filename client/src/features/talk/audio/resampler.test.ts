import { describe, expect, it } from 'vitest';

import { LinearResampler } from './resampler';

function ramp(length: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => i);
}

function feed(resampler: LinearResampler, input: Float32Array, chunk: number): number[] {
  const output: number[] = [];
  for (let offset = 0; offset < input.length; offset += chunk) {
    output.push(...resampler.process(input.subarray(offset, offset + chunk)));
  }
  return output;
}

describe('LinearResampler', () => {
  it('48 kHz → 8 kHz: ได้ sample ทุกตัวที่ 6 และจำนวนตรงอัตรา แม้ป้อนก้อนละ 128 (quantum ของ worklet)', () => {
    const output = feed(new LinearResampler(48000, 8000), ramp(384), 128);

    expect(output).toHaveLength(64);
    expect(output.slice(0, 4)).toEqual([0, 6, 12, 18]);
    expect(output[63]).toBe(378);
  });

  it('8 kHz → 48 kHz: เติมค่าระหว่าง sample เป็นเส้นตรง และต่อขอบ frame ได้เนียน', () => {
    const output = feed(new LinearResampler(8000, 48000), ramp(320), 160);

    expect(output).toHaveLength(1914);
    output.forEach((value, k) => expect(value).toBeCloseTo(k / 6, 3));
  });

  it('อัตราส่วนไม่ลงตัว (44.1 kHz → 8 kHz): จำนวน output สะสมไม่ drift ตลอดหลายร้อยก้อน', () => {
    const resampler = new LinearResampler(44100, 8000);
    let total = 0;
    for (let i = 0; i < 100; i += 1) total += resampler.process(new Float32Array(128)).length;

    // output ที่ตำแหน่ง k × 44100/8000 < 12799 → k = 0…2321
    expect(total).toBe(2322);
  });

  it('**ผลลัพธ์ไม่ขึ้นกับขนาดก้อนที่ป้อน** — ป้อนทีเดียวกับป้อนทีละก้อนได้เสียงเดียวกัน', () => {
    const sine = Float32Array.from({ length: 4800 }, (_, i) =>
      Math.sin((2 * Math.PI * 440 * i) / 48000),
    );
    const whole = Array.from(new LinearResampler(48000, 8000).process(sine));
    const chunked = feed(new LinearResampler(48000, 8000), sine, 128);

    expect(chunked).toHaveLength(whole.length);
    chunked.forEach((value, i) => expect(value).toBeCloseTo(whole[i], 6));

    const voice = Float32Array.from({ length: 800 }, (_, i) =>
      Math.sin((2 * Math.PI * 300 * i) / 8000),
    );
    const wholeUp = Array.from(new LinearResampler(8000, 44100).process(voice));
    const chunkedUp = feed(new LinearResampler(8000, 44100), voice, 160);

    expect(chunkedUp).toHaveLength(wholeUp.length);
    chunkedUp.forEach((value, i) => expect(value).toBeCloseTo(wholeUp[i], 6));
  });

  it('rate เท่ากัน = ค่าเดิม (หน่วง 1 sample ตามที่ออกแบบ)', () => {
    const input = Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const output = feed(new LinearResampler(8000, 8000), input, 4);

    expect(output).toHaveLength(5);
    output.forEach((value, i) => expect(value).toBeCloseTo(input[i], 6));
  });

  it('ก้อนว่างไม่เปลี่ยนสถานะ', () => {
    const resampler = new LinearResampler(48000, 8000);

    expect(resampler.process(new Float32Array(0))).toHaveLength(0);
    expect(Array.from(resampler.process(ramp(13)))).toEqual([0, 6]);
  });

  it('sample rate ไม่ถูกต้อง -> RangeError', () => {
    expect(() => new LinearResampler(0, 8000)).toThrow(RangeError);
    expect(() => new LinearResampler(48000, Number.NaN)).toThrow(RangeError);
    expect(() => new LinearResampler(-8000, 8000)).toThrow(RangeError);
  });
});

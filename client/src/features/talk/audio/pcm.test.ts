import { describe, expect, it } from 'vitest';

import {
  decodePcm16le,
  encodePcm16le,
  floatToInt16,
  int16ToFloat,
  Pcm16Framer,
  peakOf,
} from './pcm';

describe('floatToInt16', () => {
  it('ขอบบน-ล่างตรงตามช่วงของ Int16 (บวกถึง 32767 · ลบถึง -32768)', () => {
    expect(floatToInt16(0)).toBe(0);
    expect(floatToInt16(1)).toBe(32767);
    expect(floatToInt16(-1)).toBe(-32768);
    expect(floatToInt16(0.5)).toBe(16384);
    expect(floatToInt16(-0.5)).toBe(-16384);
  });

  it('**clamp ค่าที่เกิน [-1, 1]** — ไม่วนกลับเป็นเสียงแตกฝั่งตรงข้าม', () => {
    expect(floatToInt16(1.7)).toBe(32767);
    expect(floatToInt16(-3)).toBe(-32768);
    expect(floatToInt16(Number.POSITIVE_INFINITY)).toBe(32767);
    expect(floatToInt16(Number.NEGATIVE_INFINITY)).toBe(-32768);
  });

  it('NaN -> 0 (เงียบ) ไม่ใช่ค่าขยะ', () => {
    expect(floatToInt16(Number.NaN)).toBe(0);
  });
});

describe('int16ToFloat', () => {
  it('กลับเป็นช่วง [-1, 1] พอดี', () => {
    expect(int16ToFloat(32767)).toBe(1);
    expect(int16ToFloat(-32768)).toBe(-1);
    expect(int16ToFloat(0)).toBe(0);
  });
});

describe('encodePcm16le / decodePcm16le', () => {
  it('**เรียง byte แบบ little-endian** ตามสัญญา ไม่ขึ้นกับเครื่อง', () => {
    const bytes = new Uint8Array(encodePcm16le(new Float32Array([1, -1, 256 / 32767])));
    expect(Array.from(bytes)).toEqual([0xff, 0x7f, 0x00, 0x80, 0x00, 0x01]);
  });

  it('encode แล้ว decode กลับได้ค่าเดิมภายในหนึ่งขั้น quantization', () => {
    const samples = new Float32Array([0, 0.25, -0.25, 0.999, -0.999, 0.1234]);
    const back = decodePcm16le(encodePcm16le(samples));
    expect(back).toHaveLength(samples.length);
    samples.forEach((value, i) => {
      expect(Math.abs(back[i] - value)).toBeLessThanOrEqual(1 / 32767);
    });
  });

  it('byte เศษตัวสุดท้าย (ความยาวคี่) ถูกทิ้ง ไม่ throw', () => {
    const decoded = decodePcm16le(new Uint8Array([0x00, 0x01, 0x7f]).buffer);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toBeCloseTo(256 / 32767, 6);
  });
});

describe('peakOf', () => {
  it('คืนค่าสัมบูรณ์สูงสุด และไม่เกิน 1', () => {
    expect(peakOf(new Float32Array([0.1, -0.75, 0.5]))).toBeCloseTo(0.75, 6);
    expect(peakOf(new Float32Array([0.2, -1.5]))).toBe(1);
    expect(peakOf(new Float32Array(0))).toBe(0);
  });
});

describe('Pcm16Framer', () => {
  it('**frame ยาวพอดี frameSamples × 2 byte** — ที่ 8 kHz / 40ms คือ 640 byte', () => {
    const framer = new Pcm16Framer(320);
    expect(framer.push(new Float32Array(200))).toEqual([]);

    const frames = framer.push(new Float32Array(200));
    expect(frames).toHaveLength(1);
    expect(frames[0].bytes.byteLength).toBe(640);
  });

  it('ก้อนใหญ่ได้หลาย frame ครบ และเก็บเศษไว้ต่อก้อนถัดไป', () => {
    const framer = new Pcm16Framer(320);
    framer.push(new Float32Array(40));

    const frames = framer.push(new Float32Array(700));
    expect(frames.map((frame) => frame.bytes.byteLength)).toEqual([640, 640]);
    expect(framer.push(new Float32Array(219))).toEqual([]);
    expect(framer.push(new Float32Array(1))).toHaveLength(1);
  });

  it('ลำดับ sample ต่อเนื่องข้ามขอบ frame', () => {
    const framer = new Pcm16Framer(4);
    const values = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    const frames = [
      ...framer.push(new Float32Array(values.slice(0, 3))),
      ...framer.push(new Float32Array(values.slice(3))),
    ];
    const decoded = frames.flatMap((frame) => Array.from(decodePcm16le(frame.bytes)));
    expect(decoded).toHaveLength(8);
    decoded.forEach((value, i) => expect(value).toBeCloseTo(values[i], 3));
  });

  it('peak ของแต่ละ frame มาจาก sample ของ frame นั้นเท่านั้น', () => {
    const framer = new Pcm16Framer(4);
    const [loud, quiet] = framer.push(new Float32Array([0.1, -0.75, 0.5, 0, 0.1, 0.2, 0, 0]));
    expect(loud.peak).toBeCloseTo(0.75, 6);
    expect(quiet.peak).toBeCloseTo(0.2, 6);
  });

  it('frameSamples ต้องเป็นจำนวนเต็มบวก', () => {
    expect(() => new Pcm16Framer(0)).toThrow(RangeError);
    expect(() => new Pcm16Framer(160.5)).toThrow(RangeError);
  });
});

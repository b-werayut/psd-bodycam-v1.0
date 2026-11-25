import { describe, expect, it } from 'vitest';

import { JitterBuffer, TALK_JITTER } from './jitterBuffer';

/** sampleRate 1000 = 1 sample ต่อ 1ms — prebuffer 80 sample · max 300 sample */
const make = () => new JitterBuffer({ sampleRate: 1000, prebufferMs: 80, maxMs: 300 });

const sequence = (from: number, length: number) =>
  Float32Array.from({ length }, (_, i) => from + i);

function pull(buffer: JitterBuffer, count: number): number[] {
  const target = new Float32Array(count);
  buffer.pullInto(target);
  return Array.from(target);
}

describe('JitterBuffer', () => {
  it('ค่าตาม spec: สะสม 80ms · เก็บไม่เกิน 300ms', () => {
    expect(TALK_JITTER).toEqual({ prebufferMs: 80, maxMs: 300 });
  });

  it('ยังสะสมไม่ถึง 80ms -> เล่นเงียบและไม่ดึงข้อมูลออก', () => {
    const buffer = make();
    buffer.push(sequence(1, 50));

    expect(pull(buffer, 10)).toEqual(Array(10).fill(0));
    expect(buffer.bufferedSamples).toBe(50);
    expect(buffer.playing).toBe(false);
  });

  it('สะสมครบ 80ms -> เริ่มเล่นตามลำดับ', () => {
    const buffer = make();
    buffer.push(sequence(1, 50));
    buffer.push(sequence(51, 30));

    expect(buffer.playing).toBe(true);
    expect(pull(buffer, 10)).toEqual(Array.from(sequence(1, 10)));
    expect(buffer.bufferedSamples).toBe(70);
  });

  it('**เกิน 300ms -> ทิ้งส่วนเก่าสุด** เหลือ 300ms ล่าสุด', () => {
    const buffer = make();
    buffer.push(sequence(1, 400));

    expect(buffer.bufferedSamples).toBe(300);
    expect(pull(buffer, 3)).toEqual([101, 102, 103]);
  });

  it('ล้นจากการ push ทีละก้อน -> ทิ้งเฉพาะส่วนที่ล้น', () => {
    const buffer = make();
    buffer.push(sequence(1, 250));
    buffer.push(sequence(251, 100));

    expect(buffer.bufferedSamples).toBe(300);
    expect(pull(buffer, 2)).toEqual([51, 52]);
  });

  it('**ข้อมูลขาดกลางทาง -> เติมเงียบส่วนที่ขาด แล้วสะสมใหม่ก่อนเล่นต่อ**', () => {
    const buffer = make();
    buffer.push(sequence(1, 80));
    expect(pull(buffer, 70)).toEqual(Array.from(sequence(1, 70)));

    expect(pull(buffer, 20)).toEqual([...Array.from(sequence(71, 10)), ...Array(10).fill(0)]);
    expect(buffer.playing).toBe(false);

    buffer.push(sequence(81, 50));
    expect(pull(buffer, 5)).toEqual(Array(5).fill(0));

    buffer.push(sequence(131, 30));
    expect(pull(buffer, 3)).toEqual([81, 82, 83]);
  });

  it('ring buffer วนรอบหลายรอบแล้วลำดับยังต่อเนื่อง', () => {
    const buffer = make();
    buffer.push(sequence(1, 100));
    const played: number[] = [];
    let next = 101;
    for (let round = 0; round < 50; round += 1) {
      buffer.push(sequence(next, 37));
      next += 37;
      played.push(...pull(buffer, 37));
    }

    expect(played).toEqual(Array.from(sequence(1, 50 * 37)));
  });

  it('ค่าตั้งต้นต้องสมเหตุสมผล', () => {
    expect(() => new JitterBuffer({ sampleRate: 1000, prebufferMs: 400, maxMs: 300 })).toThrow(
      RangeError,
    );
    expect(() => new JitterBuffer({ sampleRate: 0, prebufferMs: 80, maxMs: 300 })).toThrow(
      RangeError,
    );
  });
});

import { JitterBuffer, TALK_JITTER } from './jitterBuffer';
import { decodePcm16le } from './pcm';
import { LinearResampler } from './resampler';

/**
 * ขาลงตามลำดับใน spec: frame PCM16LE → jitter buffer (ที่ rate ขาลง) → แปลงเป็น rate ของ context
 *
 * buffer เก็บที่ rate ขาลงเพื่อให้ "สะสม 80ms" หมายถึง 80ms ของเสียงที่ได้รับจริง — ถ้าแปลง rate ก่อน
 * resampler จะหน่วง sample สุดท้ายของแต่ละ frame ไว้ ยอดสะสมจึงขาด 80ms ไปนิดเดียวจนต้องรอ
 * frame ถัดไปทั้ง frame (+40ms เมื่อ frame ละ 40ms)
 *
 * `render()` ดึงจาก buffer เท่าที่ต้องใช้ แปลง rate แล้วเติม target ให้เต็มพอดีทุกครั้ง —
 * ส่วนที่แปลงเกินมาเก็บไว้ใช้ครั้งถัดไป
 */
export class DownlinkPlayer {
  private readonly buffer: JitterBuffer;
  private readonly resampler: LinearResampler;
  private readonly sourceRate: number;
  private readonly outputRate: number;
  private pending: Float32Array = new Float32Array(0);
  private pendingIndex = 0;

  constructor(sourceRate: number, outputRate: number) {
    this.buffer = new JitterBuffer({ sampleRate: sourceRate, ...TALK_JITTER });
    this.resampler = new LinearResampler(sourceRate, outputRate);
    this.sourceRate = sourceRate;
    this.outputRate = outputRate;
  }

  push(bytes: ArrayBuffer): void {
    this.buffer.push(decodePcm16le(bytes));
  }

  render(target: Float32Array): void {
    let filled = 0;
    // ทุกรอบได้ output อย่างน้อย 1 ตัวเสมอ · กันวนไม่รู้จบไว้เผื่อค่า rate แปลก ๆ
    for (let round = 0; filled < target.length && round < 8; round += 1) {
      if (this.pendingIndex >= this.pending.length) {
        const needed = Math.ceil(((target.length - filled) * this.sourceRate) / this.outputRate) + 1;
        const source = new Float32Array(needed);
        this.buffer.pullInto(source);
        this.pending = this.resampler.process(source);
        this.pendingIndex = 0;
      }
      const take = Math.min(target.length - filled, this.pending.length - this.pendingIndex);
      target.set(this.pending.subarray(this.pendingIndex, this.pendingIndex + take), filled);
      this.pendingIndex += take;
      filled += take;
    }
    if (filled < target.length) target.fill(0, filled);
  }
}

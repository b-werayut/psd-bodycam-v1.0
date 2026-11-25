/**
 * แปลง sample rate แบบ linear interpolation ทีละก้อน (streaming) — จำตำแหน่งและ sample สุดท้าย
 * ข้ามก้อน จึงต่อกันได้เนียนไม่ว่าจะป้อนก้อนละกี่ sample
 *
 * - ขาขึ้น: rate ของ AudioContext (48k / 44.1k) → uplinkSampleRate — มี BiquadFilter lowpass 3.4 kHz
 *   กรองก่อนเข้ามาแล้ว (กัน aliasing) ตัวนี้จึงไม่ต้องกรองเอง
 * - ขาลง: downlinkSampleRate → rate ของ AudioContext
 *
 * ตำแหน่งอ่านเก็บเป็น**จำนวนเต็ม**ในหน่วย 1/toRate ของ sample ขาเข้า — ไม่สะสม error ของทศนิยม
 * จำนวน output จึงตรงอัตราเป๊ะแม้คุยยาวเป็นชั่วโมง
 *
 * output ที่ตกตรงปลายก้อนพอดีจะออกในก้อนถัดไป (ต้องรู้ sample ถัดไปก่อนจึง interpolate ได้)
 * = หน่วงไม่เกิน 1 sample ของขาเข้า
 */
export class LinearResampler {
  private readonly from: number;
  private readonly to: number;
  /** ตำแหน่งอ่านถัดไป = offset / to sample นับจากต้นก้อนที่จะป้อน · ติดลบ = ระหว่าง previous กับ sample แรก */
  private offset = 0;
  private previous = 0;

  constructor(fromRate: number, toRate: number) {
    const valid = (rate: number) => Number.isFinite(rate) && rate > 0;
    if (!valid(fromRate) || !valid(toRate)) {
      throw new RangeError(`sample rate ต้องเป็นจำนวนบวก (ได้ ${fromRate} → ${toRate})`);
    }
    this.from = Math.round(fromRate);
    this.to = Math.round(toRate);
  }

  process(input: Float32Array): Float32Array {
    const length = input.length;
    if (length === 0) return new Float32Array(0);

    const limit = (length - 1) * this.to;
    const count = this.offset < limit ? Math.ceil((limit - this.offset) / this.from) : 0;
    const output = new Float32Array(count);
    let offset = this.offset;
    for (let k = 0; k < count; k += 1) {
      const index = Math.floor(offset / this.to);
      const fraction = (offset - index * this.to) / this.to;
      const left = index < 0 ? this.previous : input[index];
      output[k] = left + (input[index + 1] - left) * fraction;
      offset += this.from;
    }

    this.offset = offset - length * this.to;
    this.previous = input[length - 1];
    return output;
  }
}

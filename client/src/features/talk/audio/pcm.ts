/**
 * PCM16LE mono — รูปแบบเสียงเดียวที่วิ่งระหว่าง browser · Nest · FastAPI
 * (spec หัวข้อ "รูปแบบข้อความบน WebSocket")
 *
 * ใช้ DataView เขียน/อ่านแบบ little-endian ตรง ๆ ไม่พึ่ง endianness ของเครื่อง
 */

export function floatToInt16(sample: number): number {
  if (Number.isNaN(sample)) return 0;
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

export function int16ToFloat(value: number): number {
  return value < 0 ? value / 0x8000 : value / 0x7fff;
}

export function encodePcm16le(samples: Float32Array): ArrayBuffer {
  const bytes = new ArrayBuffer(samples.length * 2);
  const view = new DataView(bytes);
  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(i * 2, floatToInt16(samples[i]), true);
  }
  return bytes;
}

/** byte เศษตัวสุดท้าย (ความยาวคี่) ถูกทิ้ง — server รับประกันว่าขาลงยาวเป็นเลขคู่อยู่แล้ว */
export function decodePcm16le(bytes: ArrayBuffer): Float32Array {
  const view = new DataView(bytes);
  const samples = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = int16ToFloat(view.getInt16(i * 2, true));
  }
  return samples;
}

/** ค่าสัมบูรณ์สูงสุดของช่วงนั้น (0–1) — ใช้ทำแถบระดับเสียงไมค์ */
export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const magnitude = Math.abs(samples[i]);
    if (magnitude > peak) peak = magnitude;
  }
  return Math.min(1, peak);
}

export type PcmFrame = { bytes: ArrayBuffer; peak: number };

/**
 * รวม sample (float) ให้เป็น frame PCM16LE ขนาดพอดี `frameSamples` — server ตัดสาย 1008
 * ถ้าขาขึ้นยาวไม่พอดี `uplinkSampleRate × frameMs / 1000 × 2` byte
 */
export class Pcm16Framer {
  private readonly frameSamples: number;
  private readonly pending: Float32Array;
  private filled = 0;

  constructor(frameSamples: number) {
    if (!Number.isInteger(frameSamples) || frameSamples <= 0) {
      throw new RangeError(`frameSamples ต้องเป็นจำนวนเต็มบวก (ได้ ${frameSamples})`);
    }
    this.frameSamples = frameSamples;
    this.pending = new Float32Array(frameSamples);
  }

  push(samples: Float32Array): PcmFrame[] {
    const frames: PcmFrame[] = [];
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(this.frameSamples - this.filled, samples.length - offset);
      this.pending.set(samples.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === this.frameSamples) {
        frames.push({ bytes: encodePcm16le(this.pending), peak: peakOf(this.pending) });
        this.filled = 0;
      }
    }
    return frames;
  }
}

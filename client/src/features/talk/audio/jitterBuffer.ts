/** ค่าตาม spec — สะสม 80ms ก่อนเริ่มเล่น · เก็บไม่เกิน 300ms (เกินให้ทิ้งส่วนเก่า) */
export const TALK_JITTER = { prebufferMs: 80, maxMs: 300 } as const;

export type JitterBufferOptions = { sampleRate: number; prebufferMs: number; maxMs: number };

/**
 * buffer เสียงขาลงแบบ ring buffer (ไม่ allocate ระหว่างเล่น — `pullInto` เขียนลง array ของ worklet ตรง ๆ)
 *
 * - ยังสะสมไม่ถึง prebuffer = เล่นเงียบ และยังไม่ดึงข้อมูลออก
 * - เกิน max = ทิ้ง sample เก่าสุด (กันดีเลย์สะสมเมื่อเครือข่ายส่งมาเป็นก้อน)
 * - ข้อมูลขาดระหว่างเล่น (underrun) = เติมเงียบส่วนที่ขาด แล้วกลับไปสะสมใหม่
 */
export class JitterBuffer {
  private readonly ring: Float32Array;
  private readonly prebuffer: number;
  private readIndex = 0;
  private size = 0;
  private buffering = true;

  constructor({ sampleRate, prebufferMs, maxMs }: JitterBufferOptions) {
    const capacity = Math.round((sampleRate * maxMs) / 1000);
    const prebuffer = Math.round((sampleRate * prebufferMs) / 1000);
    if (!(capacity > 0) || !(prebuffer > 0) || prebuffer > capacity) {
      throw new RangeError(
        `ค่า jitter buffer ไม่ถูกต้อง (sampleRate ${sampleRate} · prebuffer ${prebufferMs}ms · max ${maxMs}ms)`,
      );
    }
    this.ring = new Float32Array(capacity);
    this.prebuffer = prebuffer;
  }

  get bufferedSamples(): number {
    return this.size;
  }

  get playing(): boolean {
    return !this.buffering;
  }

  push(samples: Float32Array): void {
    const capacity = this.ring.length;
    const incoming =
      samples.length > capacity ? samples.subarray(samples.length - capacity) : samples;
    const overflow = this.size + incoming.length - capacity;
    if (overflow > 0) {
      this.readIndex = (this.readIndex + overflow) % capacity;
      this.size -= overflow;
    }

    let write = (this.readIndex + this.size) % capacity;
    for (let i = 0; i < incoming.length; i += 1) {
      this.ring[write] = incoming[i];
      write = write + 1 === capacity ? 0 : write + 1;
    }
    this.size += incoming.length;
    if (this.buffering && this.size >= this.prebuffer) this.buffering = false;
  }

  pullInto(target: Float32Array): void {
    target.fill(0);
    if (this.buffering) return;

    const capacity = this.ring.length;
    const available = Math.min(target.length, this.size);
    for (let i = 0; i < available; i += 1) {
      target[i] = this.ring[this.readIndex];
      this.readIndex = this.readIndex + 1 === capacity ? 0 : this.readIndex + 1;
    }
    this.size -= available;
    if (available < target.length) this.buffering = true;
  }
}

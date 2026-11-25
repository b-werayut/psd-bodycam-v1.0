import type { RawData } from 'ws';
import {
  TALK_MAX_FRAMES_PER_WINDOW,
  TALK_MAX_PAYLOAD_BYTES,
  TALK_RATE_WINDOW_MS,
} from './talk-constants';

export type FrameVerdict = 'ok' | 'size' | 'rate';

/** ขนาด frame ขาขึ้นที่ต้องพอดี — PCM16LE mono = 2 byte ต่อ sample (8000 Hz × 40 ms = 640 byte) */
export function uplinkFrameBytes(sampleRate: number, frameMs: number): number {
  return Math.round((sampleRate * frameMs) / 1000) * 2;
}

/**
 * ตรวจ frame ขาขึ้นของ 1 สาย: ขนาดต้องพอดี และไม่เกิน 75 frame ในหน้าต่าง 1 วินาที
 * (อัตราปกติที่ frame 40 ms คือ 25 frame/วินาที — เพดานเผื่อ jitter ของ browser)
 * หน้าต่างเริ่มนับใหม่ที่ frame แรกหลังหน้าต่างเดิมครบเวลา
 */
export class UplinkFrameGuard {
  private windowStartedAt = Number.NEGATIVE_INFINITY;
  private framesInWindow = 0;

  constructor(
    private readonly expectedBytes: number,
    private readonly maxFramesPerWindow: number = TALK_MAX_FRAMES_PER_WINDOW,
    private readonly windowMs: number = TALK_RATE_WINDOW_MS,
  ) {}

  check(byteLength: number, nowMs: number): FrameVerdict {
    if (byteLength !== this.expectedBytes) return 'size';
    if (nowMs - this.windowStartedAt >= this.windowMs) {
      this.windowStartedAt = nowMs;
      this.framesInWindow = 0;
    }
    this.framesInWindow += 1;
    return this.framesInWindow > this.maxFramesPerWindow ? 'rate' : 'ok';
  }
}

/** ขาลงยาวเท่าไรก็ได้ที่เป็นเลขคู่ (PCM16) และไม่เกิน 4096 byte */
export function isValidDownlinkFrame(byteLength: number): boolean {
  return byteLength > 0 && byteLength % 2 === 0 && byteLength <= TALK_MAX_PAYLOAD_BYTES;
}

export function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

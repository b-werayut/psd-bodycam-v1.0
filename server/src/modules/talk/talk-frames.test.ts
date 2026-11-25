import { describe, expect, it } from 'vitest';

import { UplinkFrameGuard, isValidDownlinkFrame, rawDataToBuffer, uplinkFrameBytes } from './talk-frames';

describe('uplinkFrameBytes', () => {
  it('8000 Hz × 40 ms = 640 byte (frame ที่ DSS ใช้จริงตามผล spike)', () => {
    expect(uplinkFrameBytes(8000, 40)).toBe(640);
  });

  it('คำนวณจากค่าที่ start ตอบกลับเสมอ ไม่ผูกกับ 8 kHz / 40 ms', () => {
    expect(uplinkFrameBytes(16000, 40)).toBe(1280);
    expect(uplinkFrameBytes(8000, 60)).toBe(960);
  });
});

describe('UplinkFrameGuard', () => {
  it('frame ขนาดพอดีผ่าน', () => {
    const guard = new UplinkFrameGuard(640);

    expect(guard.check(640, 0)).toBe('ok');
  });

  it('ขาดหรือเกินแม้ byte เดียว = size (รวม frame ครึ่งขนาดของรูปแบบเดิมก่อน spike)', () => {
    const guard = new UplinkFrameGuard(640);

    for (const length of [0, 160, 639, 641, 4096]) {
      expect(guard.check(length, 0), String(length)).toBe('size');
    }
  });

  it('ไม่เกิน 75 frame ในหน้าต่าง 1 วินาที — frame ที่ 76 = rate', () => {
    const guard = new UplinkFrameGuard(640);

    for (let i = 0; i < 75; i += 1) expect(guard.check(640, i)).toBe('ok');
    expect(guard.check(640, 999)).toBe('rate');
  });

  it('พ้นหน้าต่าง 1 วินาทีแล้วนับใหม่', () => {
    const guard = new UplinkFrameGuard(640);

    for (let i = 0; i < 75; i += 1) guard.check(640, 0);
    expect(guard.check(640, 1000)).toBe('ok');
  });

  it('อัตราปกติของ frame 40 ms (25 frame/วินาที) ผ่านต่อเนื่อง 10 วินาที', () => {
    const guard = new UplinkFrameGuard(640);

    for (let t = 0; t < 10_000; t += 40) expect(guard.check(640, t)).toBe('ok');
  });
});

describe('isValidDownlinkFrame', () => {
  it('เลขคู่ไม่เกิน 4096 byte ผ่าน', () => {
    for (const length of [2, 640, 4096]) expect(isValidDownlinkFrame(length), String(length)).toBe(true);
  });

  it('ว่าง · เลขคี่ · เกิน 4096 byte ไม่ผ่าน', () => {
    for (const length of [0, 1, 641, 4097, 4098]) expect(isValidDownlinkFrame(length), String(length)).toBe(false);
  });
});

describe('rawDataToBuffer', () => {
  it('รับได้ทั้ง Buffer · Buffer[] (fragment) · ArrayBuffer', () => {
    const single = Buffer.from([1, 2]);

    expect(rawDataToBuffer(single)).toBe(single);
    expect(rawDataToBuffer([Buffer.from([1]), Buffer.from([2, 3])])).toEqual(Buffer.from([1, 2, 3]));
    expect(rawDataToBuffer(new Uint8Array([4, 5]).buffer)).toEqual(Buffer.from([4, 5]));
  });
});

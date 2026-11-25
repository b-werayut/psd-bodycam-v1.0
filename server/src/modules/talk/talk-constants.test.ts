import { describe, expect, it } from 'vitest';

import {
  TALK_CLOSE_CODE,
  TALK_END_REASON,
  TALK_MESSAGE,
  TALK_OPEN_STATUSES,
  TALK_STATUS,
  browserCodeForUpstreamClose,
  closeReasonFor,
  endReasonForBrowserClose,
  endReasonForUpstreamClose,
  talkBusyMessage,
  upstreamCodeForBrowserClose,
} from './talk-constants';

describe('ตัวเลขที่ลง DB แล้ว (แดง = มีคน renumber — ถามเรื่อง migration ก่อน ห้ามแก้เลขในเทสต์)', () => {
  it('TALK_STATUS ใช้เลขเดียวกับ StreamingSessions.Status และสถานะเปิด = 1, 2 ตรงกับ WHERE ของ UX_Talk_Device_Open', () => {
    expect(TALK_STATUS).toEqual({ REQUESTED: 1, ACTIVE: 2, ENDED: 3, FAILED: 4 });
    expect(TALK_OPEN_STATUSES).toEqual([1, 2]);
  });

  it('TALK_END_REASON 1–7 ตาม spec', () => {
    expect(TALK_END_REASON).toEqual({
      USER_STOPPED: 1,
      EXPIRED: 2,
      VENDOR_ERROR: 3,
      POLICY_DISABLED: 4,
      MAX_DURATION: 5,
      DISCONNECTED: 6,
      VENDOR_ENDED: 7,
    });
  });
});

describe('close code — ชุดเดียวกับที่ client แปลเป็นข้อความ', () => {
  it('ตัวเลขตรงกับตารางใน spec', () => {
    expect(TALK_CLOSE_CODE).toEqual({
      USER_HANGUP: 1000,
      GOING_AWAY: 1001,
      FRAME: 1008,
      MAX_DURATION: 4001,
      IDLE: 4002,
      VENDOR_ENDED: 4003,
      STOPPED: 4004,
      VENDOR_ERROR: 4005,
      POLICY: 4006,
      TICKET: 4401,
    });
  });

  it('close reason เป็น tag ASCII สั้น ๆ ทุกตัว — ห้ามภาษาไทย (มาตรฐานจำกัด 123 byte)', () => {
    for (const code of Object.values(TALK_CLOSE_CODE)) {
      const reason = closeReasonFor(code);
      expect(reason, String(code)).toMatch(/^[a-z-]+$/);
      expect(Buffer.byteLength(reason, 'utf8')).toBeLessThanOrEqual(123);
    }
    expect(closeReasonFor(4001)).toBe('max-duration');
    expect(closeReasonFor(4002)).toBe('idle');
    expect(closeReasonFor(4003)).toBe('vendor-ended');
    expect(closeReasonFor(4004)).toBe('stopped');
    expect(closeReasonFor(4005)).toBe('vendor-error');
    expect(closeReasonFor(4006)).toBe('policy');
    expect(closeReasonFor(4401)).toBe('ticket');
    expect(closeReasonFor(1008)).toBe('frame');
    expect(closeReasonFor(9999)).toBe('');
  });
});

describe('แปลง close code เป็น EndReason', () => {
  it('browser ปิด 1000 = ผู้ใช้วางสาย', () => {
    expect(endReasonForBrowserClose(1000)).toBe(TALK_END_REASON.USER_STOPPED);
  });

  it('browser ปิดแบบอื่น (ปิดแท็บ 1001 · เน็ตหลุด 1006 · frame ใหญ่เกิน 1009) = สายหลุด', () => {
    for (const code of [1001, 1005, 1006, 1009]) {
      expect(endReasonForBrowserClose(code), String(code)).toBe(TALK_END_REASON.DISCONNECTED);
    }
  });

  it('FastAPI ปิดตามตารางใน spec', () => {
    expect(endReasonForUpstreamClose(1000)).toBe(TALK_END_REASON.USER_STOPPED);
    expect(endReasonForUpstreamClose(1008)).toBe(TALK_END_REASON.DISCONNECTED);
    expect(endReasonForUpstreamClose(4001)).toBe(TALK_END_REASON.MAX_DURATION);
    expect(endReasonForUpstreamClose(4002)).toBe(TALK_END_REASON.DISCONNECTED);
    expect(endReasonForUpstreamClose(4003)).toBe(TALK_END_REASON.VENDOR_ENDED);
    expect(endReasonForUpstreamClose(4005)).toBe(TALK_END_REASON.VENDOR_ERROR);
  });

  it('FastAPI ปิด 4004 ขณะ row ยังเปิด = FastAPI หาสายไม่เจอเอง · FastAPI หลุดไม่มี close frame (1006) = VENDOR_ERROR', () => {
    expect(endReasonForUpstreamClose(4004)).toBe(TALK_END_REASON.VENDOR_ERROR);
    expect(endReasonForUpstreamClose(1006)).toBe(TALK_END_REASON.VENDOR_ERROR);
    expect(endReasonForUpstreamClose(1011)).toBe(TALK_END_REASON.VENDOR_ERROR);
  });
});

describe('code ที่ส่งต่อไปอีกฝั่ง ("ฝั่งใดปิด ให้ปิดอีกฝั่งด้วย code เดียวกัน")', () => {
  it('FastAPI → browser: code ในตารางผ่านตรง · code นอกตารางกลายเป็น 4005 ให้ client แปลได้', () => {
    for (const code of [1000, 1008, 4001, 4002, 4003, 4004, 4005]) {
      expect(browserCodeForUpstreamClose(code), String(code)).toBe(code);
    }
    for (const code of [1006, 1011, 3000, 4006, 4401]) {
      expect(browserCodeForUpstreamClose(code), String(code)).toBe(TALK_CLOSE_CODE.VENDOR_ERROR);
    }
  });

  it('browser → FastAPI: 1000 ผ่านตรง · อย่างอื่น (1005/1006 ส่งบนสายไม่ได้) กลายเป็น 1001', () => {
    expect(upstreamCodeForBrowserClose(1000)).toBe(1000);
    for (const code of [1001, 1005, 1006, 1009]) {
      expect(upstreamCodeForBrowserClose(code), String(code)).toBe(TALK_CLOSE_CODE.GOING_AWAY);
    }
  });
});

describe('ข้อความผู้ใช้ (คำต่อคำจาก spec)', () => {
  it('403 / 404 / 5xx', () => {
    expect(TALK_MESSAGE.DENIED).toBe('บทบาทของคุณไม่มีสิทธิ์คุยผ่านกล้อง — ติดต่อผู้ดูแลระบบ');
    expect(TALK_MESSAGE.NO_LIVE).toBe('ไม่พบภาพสดที่เปิดอยู่ — เปิดภาพสดก่อนเริ่มคุย');
    expect(TALK_MESSAGE.SYSTEM_ERROR).toBe('ระบบเสียงขัดข้อง กรุณาลองใหม่');
    expect(TALK_MESSAGE.RTSP_FAILED).toBe('เชื่อมต่อช่องเสียงของกล้องไม่สำเร็จ');
    expect(TALK_MESSAGE.CODEC_UNSUPPORTED).toBe('กล้องรุ่นนี้ใช้รูปแบบเสียงที่ระบบยังไม่รองรับ');
    expect(TALK_MESSAGE.ALREADY_STARTING).toBe('กำลังเชื่อมต่อสายกับกล้องนี้อยู่ — รอสักครู่');
    expect(TALK_MESSAGE.USER_BUSY).toBe('คุณมีสายที่คุยอยู่กับกล้องอื่น — วางสายนั้นก่อน');
  });

  it('409 บอกชื่อคนที่คุยอยู่ · ไม่รู้ชื่อ (FastAPI ตอบ 1004) ก็ไม่ใส่วงเล็บว่าง', () => {
    expect(talkBusyMessage('หัวหน้างานทดสอบ')).toBe('อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่ (หัวหน้างานทดสอบ)');
    expect(talkBusyMessage(null)).toBe('อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่');
  });
});

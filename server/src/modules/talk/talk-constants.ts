// ตัวเลขใน TALK_STATUS / TALK_END_REASON ลง DB แล้ว — ห้าม renumber (talk-constants.test.ts ล็อกไว้)
// close code ชุดเดียวกันทั้งทอด browser ↔ Nest และ Nest ↔ FastAPI (spec หัวข้อ "รูปแบบข้อความบน WebSocket")

export const TALK_STATUS = { REQUESTED: 1, ACTIVE: 2, ENDED: 3, FAILED: 4 } as const;

export const TALK_END_REASON = {
  USER_STOPPED: 1,
  EXPIRED: 2,
  VENDOR_ERROR: 3,
  POLICY_DISABLED: 4,
  MAX_DURATION: 5,
  DISCONNECTED: 6,
  VENDOR_ENDED: 7,
} as const;

export type TalkEndReason = (typeof TALK_END_REASON)[keyof typeof TALK_END_REASON];

/** ต้องตรงกับ WHERE ของ UX_Talk_Device_Open ใน schema.ts */
export const TALK_OPEN_STATUSES: number[] = [TALK_STATUS.REQUESTED, TALK_STATUS.ACTIVE];

export const TALK_CLOSE_CODE = {
  USER_HANGUP: 1000,
  /** ใช้เฉพาะขา Nest → FastAPI เมื่อ browser หายไป (1005/1006 ส่งบนสายไม่ได้) และตอนปิดโปรเซส */
  GOING_AWAY: 1001,
  FRAME: 1008,
  MAX_DURATION: 4001,
  IDLE: 4002,
  VENDOR_ENDED: 4003,
  STOPPED: 4004,
  VENDOR_ERROR: 4005,
  POLICY: 4006,
  TICKET: 4401,
} as const;

// close reason เป็น tag ASCII สั้น ๆ เท่านั้น — มาตรฐานจำกัด 123 byte และอักษรไทยกิน 3 byte ต่อตัว
// client แปล close code เป็นข้อความผ่าน i18n เอง ไม่อ่าน reason
const CLOSE_REASON: Record<number, string> = {
  [TALK_CLOSE_CODE.USER_HANGUP]: 'hangup',
  [TALK_CLOSE_CODE.GOING_AWAY]: 'going-away',
  [TALK_CLOSE_CODE.FRAME]: 'frame',
  [TALK_CLOSE_CODE.MAX_DURATION]: 'max-duration',
  [TALK_CLOSE_CODE.IDLE]: 'idle',
  [TALK_CLOSE_CODE.VENDOR_ENDED]: 'vendor-ended',
  [TALK_CLOSE_CODE.STOPPED]: 'stopped',
  [TALK_CLOSE_CODE.VENDOR_ERROR]: 'vendor-error',
  [TALK_CLOSE_CODE.POLICY]: 'policy',
  [TALK_CLOSE_CODE.TICKET]: 'ticket',
};

export function closeReasonFor(code: number): string {
  return CLOSE_REASON[code] ?? '';
}

/** code ที่ FastAPI ปิดได้และ client แปลได้ — ส่งต่อตรง ๆ */
const FORWARDABLE_TO_BROWSER: readonly number[] = [
  TALK_CLOSE_CODE.USER_HANGUP,
  TALK_CLOSE_CODE.FRAME,
  TALK_CLOSE_CODE.MAX_DURATION,
  TALK_CLOSE_CODE.IDLE,
  TALK_CLOSE_CODE.VENDOR_ENDED,
  TALK_CLOSE_CODE.STOPPED,
  TALK_CLOSE_CODE.VENDOR_ERROR,
];

/** FastAPI ปิดขาของตัวเอง → code ที่ส่งให้ browser (นอกตาราง เช่น 1006 FastAPI ล่ม = 4005) */
export function browserCodeForUpstreamClose(code: number): number {
  return FORWARDABLE_TO_BROWSER.includes(code) ? code : TALK_CLOSE_CODE.VENDOR_ERROR;
}

/** browser ปิด → code ที่ส่งให้ FastAPI (1005/1006 ส่งบนสายไม่ได้ จึงใช้ 1001) */
export function upstreamCodeForBrowserClose(code: number): number {
  return code === TALK_CLOSE_CODE.USER_HANGUP ? TALK_CLOSE_CODE.USER_HANGUP : TALK_CLOSE_CODE.GOING_AWAY;
}

/** browser ปิดเอง — 1000 = วางสาย · อย่างอื่น (ปิดแท็บ · เน็ตหลุด) = สายหลุด */
export function endReasonForBrowserClose(code: number): TalkEndReason {
  return code === TALK_CLOSE_CODE.USER_HANGUP ? TALK_END_REASON.USER_STOPPED : TALK_END_REASON.DISCONNECTED;
}

/** FastAPI ปิดขาของตัวเอง — ตามตาราง close code ของ spec */
export function endReasonForUpstreamClose(code: number): TalkEndReason {
  switch (code) {
    case TALK_CLOSE_CODE.USER_HANGUP:
      return TALK_END_REASON.USER_STOPPED;
    case TALK_CLOSE_CODE.FRAME:
    case TALK_CLOSE_CODE.IDLE:
      return TALK_END_REASON.DISCONNECTED;
    case TALK_CLOSE_CODE.MAX_DURATION:
      return TALK_END_REASON.MAX_DURATION;
    case TALK_CLOSE_CODE.VENDOR_ENDED:
      return TALK_END_REASON.VENDOR_ENDED;
    case TALK_CLOSE_CODE.STOPPED:
      // row ยังเปิด = FastAPI หาสายไม่เจอเอง · ถ้าผู้สั่ง stop ปิด row ไปก่อนแล้ว end() ไม่ทับค่าเดิม (คงค่าตาม spec)
      return TALK_END_REASON.VENDOR_ERROR;
    default:
      // 4005 · 1006 (FastAPI ล่ม / restart) · code อื่นที่ไม่อยู่ในตาราง
      return TALK_END_REASON.VENDOR_ERROR;
  }
}

/** code ใน {code, desc, data} ที่ FastAPI ตอบ (spec หัวข้อ FastAPI → Error code) */
export const TALK_VENDOR_CODE = {
  SUCCESS: 1000,
  DEVICE_REJECTED: 1001,
  RTSP_FAILED: 1002,
  CODEC_UNSUPPORTED: 1003,
  BUSY: 1004,
} as const;

export const TALK_WS_PATH = '/api/talk/ws';
export const TALK_TICKET_TTL_MS = 30_000;
export const TALK_REVALIDATE_MS = 15_000;
/** ต้องยาวกว่าเวลาที่ start ใช้ได้มากที่สุด (login + TALK_START_TIMEOUT_MS) ไม่งั้น TalkIdle ปิดสายที่กำลังเชื่อมต่อ */
export const TALK_IDLE_EXPIRE_MS = 60_000;
/** FastAPI ทำ StartTalk + RTSP handshake ในคำขอเดียว — ผล spike: DSS ตอบ DESCRIBE หลัง ~10.4 วินาที รวม ~11 วินาที */
export const TALK_START_TIMEOUT_MS = 30_000;
export const TALK_MAX_PAYLOAD_BYTES = 4096;
export const TALK_MAX_FRAMES_PER_WINDOW = 75;
export const TALK_RATE_WINDOW_MS = 1_000;
export const MOCK_TALK_ECHO_DELAY_MS = 300;

export const TALK_MESSAGE = {
  DENIED: 'บทบาทของคุณไม่มีสิทธิ์คุยผ่านกล้อง — ติดต่อผู้ดูแลระบบ',
  NO_LIVE: 'ไม่พบภาพสดที่เปิดอยู่ — เปิดภาพสดก่อนเริ่มคุย',
  NOT_FOUND: 'ไม่พบสายนี้',
  DEVICE_NOT_READY: 'อุปกรณ์ไม่พร้อมรับเสียง',
  RTSP_FAILED: 'เชื่อมต่อช่องเสียงของกล้องไม่สำเร็จ',
  CODEC_UNSUPPORTED: 'กล้องรุ่นนี้ใช้รูปแบบเสียงที่ระบบยังไม่รองรับ',
  SYSTEM_ERROR: 'ระบบเสียงขัดข้อง กรุณาลองใหม่',
  ALREADY_STARTING: 'กำลังเชื่อมต่อสายกับกล้องนี้อยู่ — รอสักครู่',
  USER_BUSY: 'คุณมีสายที่คุยอยู่กับกล้องอื่น — วางสายนั้นก่อน',
} as const;

export function talkBusyMessage(fullName: string | null): string {
  return fullName
    ? `อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่ (${fullName})`
    : 'อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่';
}

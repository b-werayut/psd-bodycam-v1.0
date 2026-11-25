import { AxiosError } from 'axios';

import type { TranslationKey } from '@/i18n/locales/th';
import type { TranslationParams } from '@/i18n/types';
import { backendMessage } from '@/lib/apiError';
import { TALK_CLOSE_CODE } from './talk.api';

export const TALK_PERMISSION = 'streaming:talk';

/** ตาม spec — full-duplex จึงเปิด echoCancellation ไว้เสมอ · mono */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
};

/** ข้อความบนจอ — key ของ i18n หรือข้อความไทยจาก backend (ห้ามกลืนเป็นข้อความกลาง) */
export type TalkNotice = { key: TranslationKey; params?: TranslationParams } | { text: string };

/** close reason เป็น tag ASCII — แปลจาก close code เท่านั้น (`talk.ended.<code>`) */
const ENDED_KEY: Record<number, TranslationKey> = {
  [TALK_CLOSE_CODE.NORMAL]: 'talk.ended.1000',
  [TALK_CLOSE_CODE.NETWORK]: 'talk.ended.1006',
  [TALK_CLOSE_CODE.FRAME]: 'talk.ended.1008',
  [TALK_CLOSE_CODE.MAX_DURATION]: 'talk.ended.4001',
  [TALK_CLOSE_CODE.IDLE]: 'talk.ended.4002',
  [TALK_CLOSE_CODE.VENDOR_ENDED]: 'talk.ended.4003',
  [TALK_CLOSE_CODE.STOPPED]: 'talk.ended.4004',
  [TALK_CLOSE_CODE.VENDOR_ERROR]: 'talk.ended.4005',
  [TALK_CLOSE_CODE.POLICY]: 'talk.ended.4006',
  [TALK_CLOSE_CODE.TICKET]: 'talk.ended.4401',
};

export function talkEndedKey(code: number): TranslationKey {
  return ENDED_KEY[code] ?? 'talk.ended.other';
}

/** จำนวนนาทีของ `streaming.talk-max-seconds` — ไม่ลงตัวแสดงทศนิยม 1 ตำแหน่ง (เช่น 90 วินาที = 1.5) */
export function maxMinutesLabel(seconds: number): string {
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
}

export function talkEndedNotice(code: number, maxSeconds: number): TalkNotice {
  const key = talkEndedKey(code);
  return code === TALK_CLOSE_CODE.MAX_DURATION
    ? { key, params: { n: maxMinutesLabel(maxSeconds) } }
    : { key };
}

export function formatTalkClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** นาฬิกาใน voice pill — m:ss แบบต้นแบบ React Bits (พื้นที่จำกัด ไม่เติม 0 หน้านาที) */
export function formatPillClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function micErrorKey(error: unknown): TranslationKey {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'talk.mic.notAllowed';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'talk.mic.notFound';
    case 'NotReadableError':
    case 'AbortError':
      return 'talk.mic.notReadable';
    default:
      return 'talk.mic.failed';
  }
}

/** POST start ไม่ผ่าน — ข้อความไทยจาก Nest มาก่อนเสมอ (403 / 404 / 400 / 409 / 502) */
export function startFailureNotice(error: unknown): TalkNotice {
  const text = backendMessage(error);
  if (text) return { text };
  if (
    error instanceof AxiosError &&
    (error.code === AxiosError.ECONNABORTED || error.code === AxiosError.ETIMEDOUT)
  ) {
    return { key: 'talk.error.timeout' };
  }
  return { key: 'talk.error.start' };
}

/** 409 ที่ "ลองใหม่ทีหลังได้" — อุปกรณ์/ผู้ใช้ติดสายอื่นอยู่ หรือคำขอก่อนหน้ายังเริ่มไม่เสร็จ */
const RETRY_LATER_CODES: ReadonlySet<string> = new Set([
  'TALK_DEVICE_BUSY',
  'TALK_USER_BUSY',
  'TALK_ALREADY_STARTING',
]);

export function isTalkRetryLaterError(error: unknown): boolean {
  if (!(error instanceof AxiosError) || error.response?.status !== 409) return false;
  const code = (error.response.data as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && RETRY_LATER_CODES.has(code);
}

type TalkCapabilityScope = {
  isSecureContext?: boolean;
  navigator?: { mediaDevices?: { getUserMedia?: unknown } };
  AudioWorkletNode?: unknown;
};

/** browser เปิดไมค์ได้เฉพาะ secure context · ต้องมี getUserMedia และ AudioWorklet */
export function browserSupportsTalk(scope: TalkCapabilityScope): boolean {
  return (
    scope.isSecureContext === true &&
    typeof scope.navigator?.mediaDevices?.getUserMedia === 'function' &&
    typeof scope.AudioWorkletNode === 'function'
  );
}

/**
 * เหตุผลที่ปุ่มคุยกดไม่ได้ (disable พร้อมเหตุผล ไม่ซ่อน) — เหตุถาวรมาก่อนเหตุชั่วคราว
 * ไม่งั้นผู้ใช้รอภาพสดจนต่อติดแล้วเพิ่งรู้ว่าคุยไม่ได้อยู่ดี
 */
export function talkBlockerOf(input: {
  canTalk: boolean;
  supported: boolean;
  liveReady: boolean;
  /** หน้าภาพสดหลายจอ: จอที่เลือกยังไม่มีกล้อง — ไม่มีอะไรให้คุยด้วย ต่างจากรอภาพเชื่อมต่อ */
  targetMissing?: boolean;
}): TranslationKey | null {
  if (!input.canTalk) return 'talk.blocked.permission';
  if (!input.supported) return 'talk.blocked.unsupported';
  if (input.targetMissing) return 'talk.blocked.noCamera';
  if (!input.liveReady) return 'talk.blocked.waitingLive';
  return null;
}

/** ขนาด frame ขาขึ้นเป็นจำนวน sample — byte ที่ส่งจริง = ค่านี้ × 2 (8000 Hz × 40ms = 320 sample = 640 byte) */
export function uplinkFrameSamples(session: { uplinkSampleRate: number; frameMs: number }): number {
  return Math.round((session.uplinkSampleRate * session.frameMs) / 1000);
}

export function isTalkReadyMessage(data: string): boolean {
  try {
    const message = JSON.parse(data) as { type?: unknown } | null;
    return message?.type === 'ready';
  } catch {
    return false;
  }
}

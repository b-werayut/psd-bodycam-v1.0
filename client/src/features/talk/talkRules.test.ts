import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import { translate } from '@/i18n/translate';
import {
  browserSupportsTalk,
  formatPillClock,
  formatTalkClock,
  isTalkReadyMessage,
  isTalkRetryLaterError,
  maxMinutesLabel,
  MIC_CONSTRAINTS,
  micErrorKey,
  startFailureNotice,
  TALK_PERMISSION,
  talkBlockerOf,
  talkEndedKey,
  talkEndedNotice,
  uplinkFrameSamples,
} from './talkRules';

describe('ข้อความเมื่อสายจบ (แปลจาก close code)', () => {
  it.each([
    [1000, 'จบการสนทนาแล้ว'],
    [1006, 'สายหลุด'],
    [1008, 'ระบบเสียงขัดข้อง กรุณาลองใหม่'],
    [4002, 'สายหลุด'],
    [4003, 'กล้องตัดการเชื่อมต่อเสียง'],
    [4004, 'สายนี้ถูกปิดจากที่อื่นแล้ว'],
    [4005, 'ระบบเสียงขัดข้อง กรุณาลองใหม่'],
    [4006, 'สายถูกตัดเนื่องจากสิทธิ์หรือสถานะอุปกรณ์เปลี่ยน'],
    [4401, 'หมดเวลาเชื่อมต่อ กรุณาลองใหม่'],
  ])('code %i -> "%s"', (code, text) => {
    expect(translate('th', talkEndedKey(code))).toBe(text);
  });

  it('4001 ใส่จำนวนนาทีจาก maxSeconds ของสายนั้น', () => {
    const notice = talkEndedNotice(4001, 600);

    expect(notice).toEqual({ key: 'talk.ended.4001', params: { n: '10' } });
    expect('key' in notice && translate('th', notice.key, notice.params)).toBe(
      'ครบเวลาสูงสุด 10 นาที',
    );
  });

  it('code อื่นไม่มี params', () => {
    expect(talkEndedNotice(4003, 600)).toEqual({ key: 'talk.ended.4003' });
  });

  it('code ที่ไม่รู้จัก (เช่น 1011) -> "สายหลุด" ไม่ใช่ key ดิบ', () => {
    expect(talkEndedKey(1011)).toBe('talk.ended.other');
    expect(translate('th', talkEndedKey(1011))).toBe('สายหลุด');
  });
});

describe('maxMinutesLabel / formatTalkClock', () => {
  it('นาทีลงตัวเป็นจำนวนเต็ม ไม่ลงตัวมีทศนิยม 1 ตำแหน่ง', () => {
    expect(maxMinutesLabel(600)).toBe('10');
    expect(maxMinutesLabel(3600)).toBe('60');
    expect(maxMinutesLabel(90)).toBe('1.5');
  });

  it('นาฬิกาแบบ mm:ss', () => {
    expect(formatTalkClock(42)).toBe('00:42');
    expect(formatTalkClock(600)).toBe('10:00');
    expect(formatTalkClock(3725)).toBe('62:05');
    expect(formatTalkClock(59.9)).toBe('00:59');
    expect(formatTalkClock(-3)).toBe('00:00');
  });

  it('นาฬิกาใน voice pill แบบ m:ss (ไม่เติม 0 หน้านาที — ตามต้นแบบ)', () => {
    expect(formatPillClock(2)).toBe('0:02');
    expect(formatPillClock(600)).toBe('10:00');
    expect(formatPillClock(59.9)).toBe('0:59');
    expect(formatPillClock(-3)).toBe('0:00');
  });
});

describe('micErrorKey', () => {
  it.each([
    ['NotAllowedError', 'ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน'],
    ['SecurityError', 'ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน'],
    ['NotFoundError', 'ไม่พบไมโครโฟน'],
    ['OverconstrainedError', 'ไม่พบไมโครโฟน'],
    ['NotReadableError', 'ไมโครโฟนถูกโปรแกรมอื่นใช้อยู่'],
    ['AbortError', 'ไมโครโฟนถูกโปรแกรมอื่นใช้อยู่'],
  ])('%s -> "%s"', (name, text) => {
    expect(translate('th', micErrorKey(new DOMException('mic', name)))).toBe(text);
  });

  it('error อื่น -> ข้อความกลางของไมค์', () => {
    expect(micErrorKey(new Error('boom'))).toBe('talk.mic.failed');
    expect(micErrorKey('boom')).toBe('talk.mic.failed');
  });
});

describe('startFailureNotice', () => {
  function axiosFailure(code: string, message?: string) {
    const failure = new AxiosError('Request failed', code);
    if (message) {
      failure.response = {
        data: { message },
        status: 409,
        statusText: 'Conflict',
        headers: {},
        config: { headers: new AxiosHeaders() },
      };
    }
    return failure;
  }

  it('**ข้อความไทยจาก Nest มาก่อนเสมอ** (เช่น 409 มีผู้ใช้อื่นคุยอยู่)', () => {
    expect(
      startFailureNotice(
        axiosFailure('ERR_BAD_REQUEST', 'อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่ (สมชาย ใจดี)'),
      ),
    ).toEqual({ text: 'อุปกรณ์นี้มีผู้ใช้อื่นกำลังคุยอยู่ (สมชาย ใจดี)' });
  });

  it('POST ไม่ตอบภายใน 30 วินาที -> หมดเวลาเชื่อมต่อ', () => {
    expect(startFailureNotice(axiosFailure(AxiosError.ECONNABORTED))).toEqual({
      key: 'talk.error.timeout',
    });
    expect(startFailureNotice(axiosFailure(AxiosError.ETIMEDOUT))).toEqual({
      key: 'talk.error.timeout',
    });
  });

  it('ไม่มีข้อความจาก server -> ข้อความกลางของการเริ่มคุย', () => {
    expect(startFailureNotice(axiosFailure(AxiosError.ERR_NETWORK))).toEqual({
      key: 'talk.error.start',
    });
    expect(startFailureNotice(new Error('boom'))).toEqual({ key: 'talk.error.start' });
  });
});

describe('browserSupportsTalk', () => {
  const supported = {
    isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia: () => undefined } },
    AudioWorkletNode: class {},
  };

  it('secure context + getUserMedia + AudioWorklet -> ใช้ได้', () => {
    expect(browserSupportsTalk(supported)).toBe(true);
  });

  it('ขาดอย่างใดอย่างหนึ่ง -> ใช้ไม่ได้', () => {
    expect(browserSupportsTalk({ ...supported, isSecureContext: false })).toBe(false);
    expect(browserSupportsTalk({ ...supported, navigator: {} })).toBe(false);
    expect(browserSupportsTalk({ ...supported, AudioWorkletNode: undefined })).toBe(false);
  });
});

describe('talkBlockerOf', () => {
  it('**เหตุถาวรมาก่อนเหตุชั่วคราว**: สิทธิ์ → เบราว์เซอร์ → รอภาพสด', () => {
    expect(talkBlockerOf({ canTalk: false, supported: false, liveReady: false })).toBe(
      'talk.blocked.permission',
    );
    expect(talkBlockerOf({ canTalk: true, supported: false, liveReady: false })).toBe(
      'talk.blocked.unsupported',
    );
    expect(talkBlockerOf({ canTalk: true, supported: true, liveReady: false })).toBe(
      'talk.blocked.waitingLive',
    );
    expect(talkBlockerOf({ canTalk: true, supported: true, liveReady: true })).toBeNull();
  });

  it('**จอที่เลือกไม่มีกล้อง = บอกให้เลือกจอ** ไม่ใช่รอภาพสด — แต่สิทธิ์/เบราว์เซอร์ยังมาก่อน', () => {
    expect(
      talkBlockerOf({ canTalk: true, supported: true, liveReady: false, targetMissing: true }),
    ).toBe('talk.blocked.noCamera');
    expect(
      talkBlockerOf({ canTalk: false, supported: true, liveReady: false, targetMissing: true }),
    ).toBe('talk.blocked.permission');
  });

  it('ข้อความตรงตาม spec', () => {
    expect(translate('th', 'talk.blocked.permission')).toBe('บทบาทของคุณไม่มีสิทธิ์คุยผ่านกล้อง');
    expect(translate('th', 'talk.blocked.waitingLive')).toBe('รอภาพสดเชื่อมต่อก่อน');
    expect(translate('th', 'talk.blocked.unsupported')).toBe('เบราว์เซอร์นี้ใช้ไมโครโฟนไม่ได้');
  });
});

describe('ค่าคงที่และ helper ของโปรโตคอล', () => {
  it('ขนาด frame ขาขึ้นมาจาก start response — 8000 Hz × 40ms = 320 sample = 640 byte', () => {
    expect(uplinkFrameSamples({ uplinkSampleRate: 8000, frameMs: 40 })).toBe(320);
    expect(uplinkFrameSamples({ uplinkSampleRate: 8000, frameMs: 20 })).toBe(160);
    expect(uplinkFrameSamples({ uplinkSampleRate: 16000, frameMs: 40 })).toBe(640);
  });

  it('ready คือ text JSON {"type":"ready"} เท่านั้น', () => {
    expect(isTalkReadyMessage('{"type":"ready"}')).toBe(true);
    expect(isTalkReadyMessage('{"type":"other"}')).toBe(false);
    expect(isTalkReadyMessage('null')).toBe(false);
    expect(isTalkReadyMessage('not json')).toBe(false);
  });

  it('constraint ของไมค์และชื่อสิทธิ์ตาม spec', () => {
    expect(MIC_CONSTRAINTS).toEqual({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    expect(TALK_PERMISSION).toBe('streaming:talk');
  });
});

describe('isTalkRetryLaterError', () => {
  function failure(status: number, code: string): AxiosError {
    const error = new AxiosError('x', 'ERR_BAD_REQUEST');
    error.response = {
      data: { code },
      status,
      statusText: 'x',
      headers: {},
      config: { headers: new AxiosHeaders() },
    };
    return error;
  }

  it.each(['TALK_DEVICE_BUSY', 'TALK_USER_BUSY', 'TALK_ALREADY_STARTING'])('409 %s → true', (code) => {
    expect(isTalkRetryLaterError(failure(409, code))).toBe(true);
  });

  it('other codes / statuses / non-axios → false', () => {
    expect(isTalkRetryLaterError(failure(409, 'OTHER'))).toBe(false);
    expect(isTalkRetryLaterError(failure(502, 'TALK_START_FAILED'))).toBe(false);
    expect(isTalkRetryLaterError(new Error('x'))).toBe(false);
  });
});

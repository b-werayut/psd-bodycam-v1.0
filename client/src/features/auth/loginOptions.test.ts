import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';

import type { AuthConfig } from './auth.api';
import {
  aadstsCodeOf,
  isInteractionStuck,
  isReturningFromAzure,
  isUserCancelled,
  loginMethodsOf,
  signInErrorOf,
  TIMED_OUT,
  withTimeout,
} from './loginOptions';

const withSso: AuthConfig = {
  sso: {
    enabled: true,
    clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    tenantId: '11111111-2222-3333-4444-555555555555',
    authority: 'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555',
  },
  passwordLogin: { enabled: true },
};

describe('loginMethodsOf', () => {
  it('ยังไม่รู้ค่า config = แสดงฟอร์มรหัสผ่านไว้ก่อน ไม่ใช่หน้าว่าง', () => {
    expect(loginMethodsOf(undefined)).toEqual({
      sso: false,
      password: true,
      passwordOnly: true,
    });
  });

  it('เปิดทั้งคู่ = ไม่กางฟอร์มรหัสผ่านอัตโนมัติ (SSO เป็นทางหลัก)', () => {
    expect(loginMethodsOf(withSso)).toEqual({
      sso: true,
      password: true,
      passwordOnly: false,
    });
  });

  it('เหลือ SSO ทางเดียว = ไม่มีฟอร์มรหัสผ่านให้กางเลย', () => {
    const config: AuthConfig = { ...withSso, passwordLogin: { enabled: false } };
    expect(loginMethodsOf(config)).toEqual({
      sso: true,
      password: false,
      passwordOnly: false,
    });
  });
});

describe('isReturningFromAzure', () => {
  it('มีพารามิเตอร์ที่ Entra ส่งกลับมาบน URL = กำลังกลับมาจาก redirect', () => {
    expect(isReturningFromAzure({ hash: '#code=abc&state=%2F', search: '' })).toBe(true);
    expect(isReturningFromAzure({ hash: '', search: '?code=abc' })).toBe(true);
    expect(isReturningFromAzure({ hash: '#error=access_denied', search: '' })).toBe(true);
  });

  it('เข้าหน้าเข้าสู่ระบบตามปกติ = ไม่ใช่', () => {
    expect(isReturningFromAzure({ hash: '', search: '' })).toBe(false);
    expect(isReturningFromAzure({ hash: '#section', search: '?next=/tracking' })).toBe(false);
  });
});

describe('withTimeout', () => {
  it('เสร็จทันเพดานเวลา = คืนค่าเดิม', async () => {
    await expect(withTimeout(Promise.resolve('done'), 50)).resolves.toBe('done');
  });

  it('ช้าเกินเพดาน = คืน TIMED_OUT ไม่ค้างรอต่อ', async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).resolves.toBe(TIMED_OUT);
  });

  it('promise ล้ม = ส่ง error ต่อตามเดิม (ไม่กลืนเป็น timeout)', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom');
  });
});

describe('isUserCancelled', () => {
  it('กดยกเลิกที่หน้า Microsoft = ไม่ใช่ error ที่ต้องขึ้นสีแดง', () => {
    expect(isUserCancelled({ errorCode: 'user_cancelled' })).toBe(true);
    expect(isUserCancelled({ errorCode: 'access_denied' })).toBe(true);
  });

  it('flag ค้างจากรอบก่อน ไม่ใช่การยกเลิกของผู้ใช้ — ต้องแจ้ง', () => {
    expect(isUserCancelled({ errorCode: 'interaction_in_progress' })).toBe(false);
    expect(isInteractionStuck({ errorCode: 'interaction_in_progress' })).toBe(true);
    expect(isInteractionStuck({ errorCode: 'user_cancelled' })).toBe(false);
  });

  it('error อื่นยังต้องแจ้งผู้ใช้', () => {
    expect(isUserCancelled({ errorCode: 'endpoints_resolution_error' })).toBe(false);
    expect(isUserCancelled(new Error('boom'))).toBe(false);
    expect(isUserCancelled(null)).toBe(false);
  });
});

describe('signInErrorOf', () => {
  it('ใช้ข้อความจาก backend ก่อนเสมอ — บอกผู้ใช้ได้ว่าต้องทำอะไรต่อ', () => {
    const error = new AxiosError('Request failed');
    error.response = {
      status: 401,
      data: { message: 'บัญชี a@psd.co.th ยังไม่ได้ลงทะเบียนในระบบ กรุณาติดต่อผู้ดูแลระบบ' },
    } as never;

    expect(signInErrorOf(error)).toEqual({
      message: 'บัญชี a@psd.co.th ยังไม่ได้ลงทะเบียนในระบบ กรุณาติดต่อผู้ดูแลระบบ',
    });
  });

  it('error จาก MSAL (มี errorCode) = ข้อความเรื่องเชื่อมต่อ Microsoft', () => {
    expect(signInErrorOf({ errorCode: 'endpoints_resolution_error' })).toEqual({
      key: 'auth.ssoErrorMicrosoft',
      detail: 'endpoints_resolution_error',
    });
  });

  it('มีรหัส AADSTS = เอามาต่อท้ายแทน errorCode ทั่วไป', () => {
    const serverError = {
      errorCode: 'invalid_client',
      errorMessage:
        'AADSTS9002326: Cross-origin token redemption is permitted only for the ' +
        "'Single-Page Application' client-type.",
    };
    expect(signInErrorOf(serverError)).toEqual({
      key: 'auth.ssoErrorMicrosoft',
      detail: 'AADSTS9002326',
    });
    expect(aadstsCodeOf(serverError)).toBe('AADSTS9002326');
  });

  it('อ่านรหัสจาก `message` ได้ด้วย และไม่มีรหัส = null', () => {
    expect(aadstsCodeOf({ message: 'AADSTS54005: code already redeemed' })).toBe('AADSTS54005');
    expect(aadstsCodeOf({ errorCode: 'user_cancelled' })).toBeNull();
    expect(aadstsCodeOf(new Error('network down'))).toBeNull();
  });

  it('flag ค้าง = บอกให้รีเฟรชหน้า (ทำต่อเองได้ ต่างจาก error ทั่วไป)', () => {
    expect(signInErrorOf({ errorCode: 'interaction_in_progress' })).toEqual({
      key: 'auth.ssoErrorStuck',
    });
  });

  it('อย่างอื่น = ข้อความเชื่อมต่อระบบไม่ได้', () => {
    expect(signInErrorOf(new Error('network down'))).toEqual({ key: 'auth.errorUnavailable' });
  });
});

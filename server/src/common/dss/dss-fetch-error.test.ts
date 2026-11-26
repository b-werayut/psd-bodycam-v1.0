import { describe, expect, it } from 'vitest';
import {
  describeDssFetchFailure,
  dssEndpointLabel,
  fetchCauseCode,
  fetchCauseMessage,
} from './dss-fetch-error';

const LOGIN_URL = 'http://dss.example.test:3004/api/v1/auth/login';

/** ทรงเดียวกับที่ undici โยนจริง: TypeError ห่อ cause ที่มี code */
function fetchFailed(code: string): Error {
  const cause = Object.assign(new Error(`connect ${code} 1.2.3.4:3004`), {
    code,
    syscall: 'connect',
  });
  return Object.assign(new TypeError('fetch failed'), { cause });
}

describe('dssEndpointLabel', () => {
  it('เก็บ host+port+path ไว้ให้ไล่ต่อได้', () => {
    expect(dssEndpointLabel(LOGIN_URL)).toBe('http://dss.example.test:3004/api/v1/auth/login');
  });

  it('ตัด query string และรหัสผ่านใน URL ทิ้ง', () => {
    expect(dssEndpointLabel('https://u:secret@dss.local/api/v1/stream?_t=1730000000')).toBe(
      'https://dss.local/api/v1/stream',
    );
  });

  it('URL พังต้องเห็นค่าดิบ เพราะสาเหตุมักเป็น env ที่ติดเครื่องหมายคำพูดมาด้วย', () => {
    const label = dssEndpointLabel('"http://dss:3004/api"');
    expect(label).toContain('"http://dss:3004/api"');
    expect(label).toContain('malformed URL');
  });
});

describe('fetchCauseCode', () => {
  it('ดึง code จาก cause ชั้นเดียว', () => {
    expect(fetchCauseCode(fetchFailed('ECONNREFUSED'))).toBe('ECONNREFUSED');
  });

  it('ดึง code จาก AggregateError ที่ undici ใช้ตอนลองหลาย IP', () => {
    const aggregate = Object.assign(new AggregateError([], 'all attempts failed'), {
      errors: [Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })],
    });
    expect(fetchCauseCode(Object.assign(new TypeError('fetch failed'), { cause: aggregate }))).toBe(
      'ETIMEDOUT',
    );
  });

  it('ไม่มี code ต้องได้ null ไม่ใช่เดา', () => {
    expect(fetchCauseCode(new TypeError('fetch failed'))).toBeNull();
    expect(fetchCauseCode(null)).toBeNull();
  });
});

describe('fetchCauseMessage', () => {
  it('ข้าม "fetch failed" ไปเอาข้อความชั้นในที่บอกอะไรจริง', () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: new Error('Client network socket disconnected before secure TLS connection'),
    });
    expect(fetchCauseMessage(error)).toContain('secure TLS connection');
  });

  it('มีแต่ "fetch failed" ล้วน ต้องได้ null', () => {
    expect(fetchCauseMessage(new TypeError('fetch failed'))).toBeNull();
  });
});

describe('describeDssFetchFailure', () => {
  it('บอก URL + code + วิธีไล่ต่อ แทนที่จะบอกแค่ fetch failed', () => {
    const message = describeDssFetchFailure(LOGIN_URL, fetchFailed('ENOTFOUND'));
    expect(message).toContain('http://dss.example.test:3004/api/v1/auth/login');
    expect(message).toContain('ENOTFOUND');
    expect(message).toContain('DNS');
  });

  it('code ที่ไม่รู้จักยังต้องแสดง code ออกมา', () => {
    expect(describeDssFetchFailure(LOGIN_URL, fetchFailed('EWEIRD'))).toContain('EWEIRD');
  });

  it('firewall บล็อกขาออกต้องบอกให้ไปดู NetworkPolicy', () => {
    expect(describeDssFetchFailure(LOGIN_URL, fetchFailed('UND_ERR_CONNECT_TIMEOUT'))).toContain(
      'NetworkPolicy',
    );
  });

  it('ไม่มีอะไรให้ยึดเลย ก็ยังต้องบอก URL ที่เรียก', () => {
    const message = describeDssFetchFailure(LOGIN_URL, new TypeError('fetch failed'));
    expect(message).toContain('http://dss.example.test:3004/api/v1/auth/login');
    expect(message).toContain('network connection failed');
  });
});

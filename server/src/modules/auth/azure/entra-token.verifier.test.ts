import { describe, expect, it } from 'vitest';
import { errors as joseErrors } from 'jose';
import { describeToken, errorCode } from './entra-token.verifier';

const b64 = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const fakeToken = (header: unknown, payload: unknown): string =>
  `${b64(header)}.${b64(payload)}.c2lnbmF0dXJl`;

describe('errorCode', () => {
  it('ใช้รหัสของ jose เป็นหลัก เพราะบอกสาเหตุได้ตรงกว่าชื่อ class', () => {
    expect(errorCode(new joseErrors.JWKSNoMatchingKey())).toBe('ERR_JWKS_NO_MATCHING_KEY');
  });

  it('ถอยไปใช้ชื่อ error เมื่อไม่มีรหัส', () => {
    expect(errorCode(new Error('boom'))).toBe('Error');
  });

  it('ไม่พังเมื่อได้ค่าที่ไม่ใช่ error', () => {
    expect(errorCode(null)).toBe('UNKNOWN');
    expect(errorCode('พัง')).toBe('UNKNOWN');
  });
});

describe('describeToken', () => {
  it('บอก kid/alg/iss/aud/tid ที่ต้องใช้ไล่ปัญหา', () => {
    const token = fakeToken(
      { typ: 'JWT', alg: 'RS256', kid: 'KID-1' },
      {
        iss: 'https://login.microsoftonline.com/tenant-a/v2.0',
        aud: 'client-a',
        tid: 'tenant-a',
      },
    );

    expect(describeToken(token)).toBe(
      'kid=KID-1 alg=RS256 iss=https://login.microsoftonline.com/tenant-a/v2.0 aud=client-a tid=tenant-a',
    );
  });

  it('ไม่หลุดข้อมูลส่วนบุคคลออกมาใน log', () => {
    const token = fakeToken(
      { alg: 'RS256', kid: 'KID-1' },
      {
        iss: 'https://sts.windows.net/tenant-a/',
        aud: 'client-a',
        oid: 'oid-ของคน',
        name: 'สมชาย ใจดี',
        preferred_username: 'somchai@psd.co.th',
      },
    );

    const described = describeToken(token);
    expect(described).not.toContain('somchai@psd.co.th');
    expect(described).not.toContain('สมชาย');
    expect(described).not.toContain('oid-ของคน');
  });

  it('รวม aud ที่เป็น array ให้อ่านออก', () => {
    const token = fakeToken({ alg: 'RS256' }, { aud: ['client-a', 'client-b'] });
    expect(describeToken(token)).toContain('aud=client-a,client-b');
  });

  it('ใช้ขีดแทนฟิลด์ที่ไม่มี ไม่ขึ้น undefined', () => {
    const token = fakeToken({ alg: 'RS256' }, {});
    expect(describeToken(token)).toBe('kid=- alg=RS256 iss=- aud=- tid=-');
  });

  it('ไม่โยน exception เมื่อ token เสียรูป — ทางนี้ถูกเรียกตอน token พังอยู่แล้ว', () => {
    expect(describeToken('ไม่ใช่ jwt')).toContain('cannot read token');
    expect(describeToken('')).toContain('cannot read token');
    expect(describeToken('a.b.c')).toContain('cannot read token');
  });

  it('บอกจำนวนส่วนของ token ที่เสียรูป เพื่อแยก "ก๊อปมาไม่ครบ" ออกจาก "ส่งผิดค่า"', () => {
    expect(describeToken('eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJhIn0')).toContain('2 parts');
  });
});

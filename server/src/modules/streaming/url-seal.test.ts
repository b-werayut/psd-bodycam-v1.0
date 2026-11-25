import { describe, expect, it } from 'vitest';

import { openUrl, sealUrl, streamUrlKey } from './url-seal';

const key = streamUrlKey({ STREAM_URL_SECRET: 'test-secret-for-url-seal' } as NodeJS.ProcessEnv);
const otherKey = streamUrlKey({ STREAM_URL_SECRET: 'another-secret' } as NodeJS.ProcessEnv);

describe('streamUrlKey', () => {
  it('ได้คีย์ 32 ไบต์ (AES-256)', () => {
    expect(key.length).toBe(32);
  });

  it('ใช้ JWT_ACCESS_SECRET แทนได้ถ้าไม่ได้ตั้ง STREAM_URL_SECRET', () => {
    const fallback = streamUrlKey({ JWT_ACCESS_SECRET: 'jwt-secret' } as NodeJS.ProcessEnv);
    expect(fallback.length).toBe(32);
  });

  it('ไม่มีทั้งคู่ = ล้มทันที (ไม่ปล่อยให้ระบบทำงานโดยไม่มีคีย์)', () => {
    expect(() => streamUrlKey({} as NodeJS.ProcessEnv)).toThrow(/STREAM_URL_SECRET/);
  });
});

describe('sealUrl / openUrl', () => {
  const url = 'https://vendor.example.com/live/cam1/index.m3u8?token=abc123';

  it('binds a sealed URL to the issuing session', () => {
    const sealed = sealUrl(url, key, 'session-a');
    expect(openUrl(sealed, key, 'session-a')).toBe(url);
    expect(() => openUrl(sealed, key, 'session-b')).toThrow();
  });

  it('ห่อแล้วถอดกลับได้ค่าเดิม', () => {
    expect(openUrl(sealUrl(url, key), key)).toBe(url);
  });

  it('**อ่าน URL เดิมจากค่าที่ห่อไม่ได้** (นี่คือเหตุผลที่ต้องเข้ารหัส ไม่ใช่แค่เซ็น)', () => {
    const sealed = sealUrl(url, key);

    expect(sealed).not.toContain('vendor.example.com');
    expect(sealed).not.toContain('index.m3u8');
    expect(Buffer.from(sealed, 'base64url').toString('utf8')).not.toContain('vendor');
  });

  it('ค่าที่ห่อต่างกันทุกครั้ง (IV สุ่ม) — เดารูปแบบไม่ได้', () => {
    expect(sealUrl(url, key)).not.toBe(sealUrl(url, key));
  });

  it('ใช้ได้กับ URL ยาวและมีอักขระพิเศษ', () => {
    const long = `https://vendor.example.com/${'a'.repeat(500)}?x=${encodeURIComponent('ก ข ค')}`;
    expect(openUrl(sealUrl(long, key), key)).toBe(long);
  });

  it('ถูกแก้แม้ไบต์เดียว -> ถอดไม่ผ่าน (กันปลอม URL แล้วให้ proxy ยิงไปที่อื่น = SSRF)', () => {
    const sealed = sealUrl(url, key);
    const raw = Buffer.from(sealed, 'base64url');
    raw[raw.length - 1] ^= 0x01;

    expect(() => openUrl(raw.toString('base64url'), key)).toThrow();
  });

  it('คีย์ไม่ตรง -> ถอดไม่ผ่าน', () => {
    expect(() => openUrl(sealUrl(url, key), otherKey)).toThrow();
  });

  it('ข้อมูลสั้นเกินไป -> ตีกลับ ไม่ crash แบบอื่น', () => {
    expect(() => openUrl('AAAA', key)).toThrow(/ไม่ครบ/);
  });
});

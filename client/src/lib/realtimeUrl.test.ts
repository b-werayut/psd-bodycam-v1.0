import { describe, expect, it } from 'vitest';

import { realtimeTarget } from './realtimeUrl';

describe('realtimeTarget', () => {
  it('API อยู่ origin เดียวกัน — คืน namespace ล้วน', () => {
    expect(realtimeTarget('/api')).toBe('/realtime');
    expect(realtimeTarget(undefined)).toBe('/realtime');
    expect(realtimeTarget('')).toBe('/realtime');
  });

  it('API คนละโดเมน — ต้องคืน URL เต็มที่ชี้ไป origin ของ API', () => {
    expect(realtimeTarget('https://api.example.com/api')).toBe(
      'https://api.example.com/realtime',
    );
  });

  it('ตัด path ของ API ทิ้ง เหลือแค่ origin — namespace ไม่ได้อยู่ใต้ /api', () => {
    expect(realtimeTarget('https://api.example.com/v2/api')).toBe(
      'https://api.example.com/realtime',
    );
  });

  it('เก็บพอร์ตที่ไม่ใช่ค่ามาตรฐานไว้', () => {
    expect(realtimeTarget('http://localhost:3000/api')).toBe(
      'http://localhost:3000/realtime',
    );
  });

  it('URL ที่แกะไม่ออก ถอยไปใช้ origin ปัจจุบัน ดีกว่าโยน error ตอนเปิดแอป', () => {
    expect(realtimeTarget('ไม่ใช่ url')).toBe('/realtime');
  });
});

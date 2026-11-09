import { describe, expect, it } from 'vitest';
import { resolveTrustProxy, TRUST_PROXY_DEFAULT } from './trust-proxy';

describe('resolveTrustProxy', () => {
  it("ไม่ตั้งค่า = 'loopback' (nginx อยู่เครื่องเดียวกัน)", () => {
    expect(resolveTrustProxy({})).toEqual({ value: TRUST_PROXY_DEFAULT });
    expect(resolveTrustProxy({ TRUST_PROXY: '   ' })).toEqual({
      value: TRUST_PROXY_DEFAULT,
    });
  });

  it.each(['true', 'TRUE', 'all', 'any', '*'])(
    "ปฏิเสธ '%s' แล้วถอยไปใช้ค่าที่ปลอดภัย พร้อมบอกเหตุผล",
    (raw) => {
      const r = resolveTrustProxy({ TRUST_PROXY: raw });
      expect(r.value).toBe(TRUST_PROXY_DEFAULT);
      expect(r.error).toContain('ปลอม IP');
    },
  );

  it('ค่าที่สั่งปิด = false (ไม่เชื่อ proxy เลย) และไม่ใช่ error', () => {
    for (const raw of ['off', 'false', 'none', 'no', 'OFF']) {
      expect(resolveTrustProxy({ TRUST_PROXY: raw })).toEqual({ value: false });
    }
  });

  it('คีย์ที่ proxy-addr รู้จักผ่านได้', () => {
    expect(resolveTrustProxy({ TRUST_PROXY: 'loopback' }).value).toBe(
      'loopback',
    );
    expect(resolveTrustProxy({ TRUST_PROXY: 'uniquelocal' }).value).toBe(
      'uniquelocal',
    );
  });

  it('ตัวเลข = จำนวน hop (รวม 0 ที่แปลว่าไม่เชื่อใครเลย)', () => {
    expect(resolveTrustProxy({ TRUST_PROXY: '1' })).toEqual({ value: 1 });
    expect(resolveTrustProxy({ TRUST_PROXY: '2' })).toEqual({ value: 2 });
    expect(resolveTrustProxy({ TRUST_PROXY: '0' })).toEqual({ value: 0 });
  });

  it('รายการ IP / ช่วง IP / คีย์ ปนกันได้', () => {
    expect(
      resolveTrustProxy({ TRUST_PROXY: '10.0.0.5, 10.0.0.0/8 ,loopback' }),
    ).toEqual({ value: ['10.0.0.5', '10.0.0.0/8', 'loopback'] });
    expect(resolveTrustProxy({ TRUST_PROXY: '::1' }).value).toEqual(['::1']);
  });

  it.each(['nginx', '10.0.0.', '10.0.0.300', '10.0.0.1/8/9', '10.0.0.1/abc'])(
    "จับค่าที่ไม่ใช่ IP ('%s') ได้ตอน boot แล้วถอยไปใช้ค่าตั้งต้น",
    (raw) => {
      const r = resolveTrustProxy({ TRUST_PROXY: raw });
      expect(r.value).toBe(TRUST_PROXY_DEFAULT);
      expect(r.error).toContain('TRUST_PROXY');
    },
  );

  it('ค่าที่ดีอยู่ปนกับค่าเสีย = ปฏิเสธทั้งชุด (ไม่เดาว่าจะทิ้งตัวไหน)', () => {
    const r = resolveTrustProxy({ TRUST_PROXY: '10.0.0.1,nginx' });
    expect(r.value).toBe(TRUST_PROXY_DEFAULT);
    expect(r.error).toContain('nginx');
  });
});

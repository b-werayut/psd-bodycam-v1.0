import { describe, expect, it } from 'vitest';
import { AzureClaimsError, extractAzureIdentity } from './azure-claims';

const without = (claims: Record<string, unknown>, key: string): Record<string, unknown> => {
  const copy = { ...claims };
  delete copy[key];
  return copy;
};

const TENANT = '11111111-2222-3333-4444-555555555555';
const OID = '99999999-8888-7777-6666-555555555555';
const base = { oid: OID, tid: TENANT, preferred_username: 'Walaiphorn.A@PSD.co.th' };

describe('extractAzureIdentity', () => {
  it('อ่าน oid + อีเมล (ตัวพิมพ์เล็ก) + ชื่อที่แสดง', () => {
    expect(extractAzureIdentity({ ...base, name: 'วลัยพร' }, { tenantId: TENANT })).toEqual({
      objectId: OID,
      email: 'walaiphorn.a@psd.co.th',
      displayName: 'วลัยพร',
    });
  });

  it('ไม่มี oid = ปฏิเสธ พร้อมบอกว่าต้องเปิด optional claim ที่ไหน', () => {
    const withoutOid = without(base, 'oid');
    expect(() => extractAzureIdentity(withoutOid, { tenantId: TENANT })).toThrow(
      /Token configuration/,
    );
  });

  it('ไม่ยอมใช้ sub แทน oid — sub ต่างกันไปตามแอปที่ขอ จับคู่ข้ามระบบไม่ได้', () => {
    const withoutOid = without(base, 'oid');
    expect(() =>
      extractAzureIdentity({ ...withoutOid, sub: 'pairwise-subject' }, { tenantId: TENANT }),
    ).toThrow(AzureClaimsError);
  });

  it('คนละ tenant = ปฏิเสธ', () => {
    expect(() =>
      extractAzureIdentity({ ...base, tid: 'ffffffff-0000-0000-0000-000000000000' }, {
        tenantId: TENANT,
      }),
    ).toThrow(/คนละ tenant/);
  });

  it('ถอยไปใช้ email แล้ว upn เมื่อไม่มี preferred_username', () => {
    const noPreferred = without(base, 'preferred_username');
    expect(
      extractAzureIdentity({ ...noPreferred, email: 'a@psd.co.th' }, { tenantId: TENANT }).email,
    ).toBe('a@psd.co.th');
    expect(
      extractAzureIdentity({ ...noPreferred, upn: 'b@psd.co.th' }, { tenantId: TENANT }).email,
    ).toBe('b@psd.co.th');
  });

  it('ไม่มีอีเมลเลย = ปฏิเสธ พร้อมบอกให้ไปดู scope', () => {
    const noEmail = without(base, 'preferred_username');
    expect(() => extractAzureIdentity(noEmail, { tenantId: TENANT })).toThrow(/scope/);
  });

  it('ค่าที่ไม่ใช่อีเมล (ไม่มี @) ถือว่าใช้จับคู่ไม่ได้', () => {
    expect(() =>
      extractAzureIdentity({ ...base, preferred_username: 'walaiphorn' }, { tenantId: TENANT }),
    ).toThrow(AzureClaimsError);
  });

  it('จำกัดโดเมนได้ — นอกรายการปฏิเสธ ในรายการผ่าน', () => {
    const options = { tenantId: TENANT, allowedEmailDomains: ['psd.co.th'] };
    expect(extractAzureIdentity(base, options).email).toBe('walaiphorn.a@psd.co.th');
    expect(() =>
      extractAzureIdentity({ ...base, preferred_username: 'guest@outlook.com' }, options),
    ).toThrow(/outlook.com/);
  });

  it('รายการโดเมนว่าง = ไม่จำกัด (อาศัย tenant เป็นขอบเขต)', () => {
    expect(
      extractAzureIdentity({ ...base, preferred_username: 'x@anywhere.com' }, {
        tenantId: TENANT,
        allowedEmailDomains: [],
      }).email,
    ).toBe('x@anywhere.com');
  });

  it('ไม่มี name = displayName เป็น null ไม่ใช่สตริงว่าง', () => {
    expect(extractAzureIdentity({ ...base, name: '  ' }, { tenantId: TENANT }).displayName).toBeNull();
  });
});

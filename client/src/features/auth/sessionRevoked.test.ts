import { describe, expect, it } from 'vitest';

import { shouldSignOutWeb } from './sessionRevoked';

describe('shouldSignOutWeb', () => {
  it('scope account -> ออกจากระบบ', () => {
    expect(shouldSignOutWeb({ scope: 'account', deviceId: null })).toBe(true);
  });

  it('**scope device -> ไม่ออก** — เว็บอยู่ห้องเดียวกับมือถือ ถอนมือถือแล้วเว็บต้องไม่เด้งตาม', () => {
    expect(shouldSignOutWeb({ scope: 'device', deviceId: 'dev-a' })).toBe(false);
  });

  it('payload รุ่นเก่าที่ไม่มี scope -> ไม่ออก (ยังหลุดตอน refresh รอบถัดไปอยู่ดี)', () => {
    expect(shouldSignOutWeb({ deviceId: 'dev-a', reason: 'by-admin' })).toBe(false);
  });

  it('payload ที่ไม่ใช่ object -> ไม่ออก', () => {
    expect(shouldSignOutWeb(null)).toBe(false);
    expect(shouldSignOutWeb(undefined)).toBe(false);
    expect(shouldSignOutWeb('account')).toBe(false);
  });

  it('scope ที่ไม่รู้จัก -> ไม่ออก', () => {
    expect(shouldSignOutWeb({ scope: 'company' })).toBe(false);
  });
});

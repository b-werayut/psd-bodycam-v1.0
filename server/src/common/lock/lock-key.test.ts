import { describe, expect, it } from 'vitest';
import { lockKey, lockPrefix } from './lock-key';

describe('lockKey', () => {
  it('แยกตามชื่อ database — dev กับ test ต้องไม่แย่งล็อกกัน', () => {
    const dev = lockKey('gps:poll', {
      DATABASE_URL: 'postgres://u:p@localhost:5432/internal_bodycam',
    });
    const test = lockKey('gps:poll', {
      DATABASE_URL: 'postgres://u:p@localhost:5432/internal_bodycam_test',
    });

    expect(dev).toBe('lock:internal_bodycam:gps:poll');
    expect(test).toBe('lock:internal_bodycam_test:gps:poll');
    expect(dev).not.toBe(test);
  });

  it('LOCK_PREFIX ทับได้ (จงใจให้หลายอินสแตนซ์บน DB เดียวกันแย่งล็อกกัน)', () => {
    expect(
      lockKey('scheduler:sweep', {
        LOCK_PREFIX: 'shared',
        DATABASE_URL: 'postgres://u:p@localhost:5432/internal_bodycam',
      }),
    ).toBe('shared:scheduler:sweep');
  });

  it('ไม่มี DATABASE_URL หรืออ่านไม่ออก = ถอยไปใช้ค่าเดิม ไม่ throw', () => {
    expect(lockPrefix({})).toBe('lock');
    expect(lockPrefix({ DATABASE_URL: 'ไม่ใช่ url' })).toBe('lock');
    expect(lockKey('gps:poll', {})).toBe('lock:gps:poll');
  });
});

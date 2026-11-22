import { describe, expect, it } from 'vitest';
import {
  PERMISSION_CODES,
  RESERVED_ADMIN_PERMISSIONS,
  ROLE_CODES,
  ROLE_NAMES_TH,
  ROLE_PERMISSIONS,
  ROLE_SCOPE,
  isPermissionCode,
} from './permission-catalog';

describe('permission catalog', () => {
  it('has exactly 24 unique codes in Part 5 §5.7 order', () => {
    expect(PERMISSION_CODES).toHaveLength(24);
    expect(new Set(PERMISSION_CODES).size).toBe(24);
    expect(PERMISSION_CODES[0]).toBe('dashboard:view');
    expect(PERMISSION_CODES[23]).toBe('settings:manage');
  });

  it('every code is resource:action', () => {
    for (const code of PERMISSION_CODES) expect(code).toMatch(/^[a-z-]+:[a-z-]+$/);
  });

  it('has the 4 web roles of P0 with Thai names', () => {
    expect(ROLE_CODES).toEqual(['ADMIN', 'COMPANY_ADMIN', 'OPERATOR', 'VIEWER']);
    expect(ROLE_NAMES_TH).toEqual({
      ADMIN: 'ผู้ดูแลระบบ',
      COMPANY_ADMIN: 'ผู้ดูแลบริษัท',
      OPERATOR: 'ผู้ปฏิบัติการ',
      VIEWER: 'ผู้ดูข้อมูล',
    });
  });

  it('ADMIN holds the whole catalog', () => {
    expect(ROLE_PERMISSIONS.ADMIN).toEqual(PERMISSION_CODES);
  });

  it('OPERATOR has 18, COMPANY_ADMIN = OPERATOR + org/users manage (21), VIEWER has 9', () => {
    expect(ROLE_PERMISSIONS.OPERATOR).toHaveLength(18);
    expect(ROLE_PERMISSIONS.COMPANY_ADMIN).toHaveLength(21);
    expect(ROLE_PERMISSIONS.COMPANY_ADMIN).toEqual(
      expect.arrayContaining([...ROLE_PERMISSIONS.OPERATOR, 'org:manage', 'users:read', 'users:manage']),
    );
    expect(ROLE_PERMISSIONS.VIEWER).toEqual([
      'dashboard:view',
      'tracking:view',
      'tracking:history',
      'work-orders:read',
      'booking:read',
      'devices:read',
      'org:read',
      'notifications:read',
      'alerts:view',
    ]);
  });

  it('no non-ADMIN role holds a reserved permission', () => {
    expect(RESERVED_ADMIN_PERMISSIONS).toEqual(['audit:view', 'settings:manage', 'roles:manage']);
    for (const role of ['COMPANY_ADMIN', 'OPERATOR', 'VIEWER'] as const) {
      for (const p of RESERVED_ADMIN_PERMISSIONS) expect(ROLE_PERMISSIONS[role]).not.toContain(p);
    }
  });

  it('role permission lists only use catalog codes, without duplicates', () => {
    for (const role of ROLE_CODES) {
      const list = ROLE_PERMISSIONS[role];
      expect(new Set(list).size).toBe(list.length);
      for (const p of list) expect(isPermissionCode(p)).toBe(true);
    }
  });

  it('isPermissionCode rejects removed and unknown codes', () => {
    expect(isPermissionCode('alerts:view')).toBe(true);
    expect(isPermissionCode('sessions:read')).toBe(false);
    expect(isPermissionCode('teams:manage')).toBe(false);
    expect(isPermissionCode('')).toBe(false);
  });

  it('every P0 role has scope all', () => {
    for (const role of ROLE_CODES) expect(ROLE_SCOPE[role]).toBe('all');
  });
});

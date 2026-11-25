import { describe, expect, it } from 'vitest';
import {
  PERMISSION_CODES,
  RESERVED_SUPER_ADMIN_PERMISSIONS,
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

  it('has all five roles in the requested order with Thai names', () => {
    expect(ROLE_CODES).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER', 'TEAM_LEADER']);
    expect(ROLE_NAMES_TH).toEqual({
      SUPER_ADMIN: 'ผู้ดูแลระบบสูงสุด',
      ADMIN: 'ผู้ดูแลระบบ',
      OPERATOR: 'ผู้ปฏิบัติการ',
      VIEWER: 'ผู้ดูข้อมูล',
      TEAM_LEADER: 'หัวหน้าทีม',
    });
  });

  it('SUPER_ADMIN holds the whole catalog', () => {
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).toEqual(PERMISSION_CODES);
  });

  it('OPERATOR has 18, ADMIN = OPERATOR + org/users manage (21), VIEWER has 9', () => {
    expect(ROLE_PERMISSIONS.OPERATOR).toHaveLength(18);
    expect(ROLE_PERMISSIONS.ADMIN).toHaveLength(21);
    expect(ROLE_PERMISSIONS.ADMIN).toEqual(
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

  it('no non-SUPER_ADMIN role holds a reserved permission', () => {
    expect(RESERVED_SUPER_ADMIN_PERMISSIONS).toEqual(['audit:view', 'settings:manage', 'roles:manage']);
    for (const role of ['ADMIN', 'OPERATOR', 'VIEWER', 'TEAM_LEADER'] as const) {
      for (const p of RESERVED_SUPER_ADMIN_PERMISSIONS) expect(ROLE_PERMISSIONS[role]).not.toContain(p);
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

  it('keeps web roles at scope all and restricts TEAM_LEADER to its team', () => {
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'] as const) expect(ROLE_SCOPE[role]).toBe('all');
    expect(ROLE_SCOPE.TEAM_LEADER).toBe('team');
    expect(ROLE_PERMISSIONS.TEAM_LEADER).toEqual(['streaming:view-live']);
  });
});

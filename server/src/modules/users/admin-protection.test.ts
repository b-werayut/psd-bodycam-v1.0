import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '../../common/auth/permission-catalog';
import { AppException } from '../../common/errors/app-exception';
import {
  assertAssignableRole,
  assertGrantablePermissions,
  availableUserActions,
  canSeeUser,
} from './admin-protection';

const errorOf = (fn: () => void): AppException => {
  try {
    fn();
  } catch (error) {
    return error as AppException;
  }
  throw new Error('expected a throw');
};

describe('canSeeUser (DL55: SUPER_ADMIN accounts are hidden from non-SUPER_ADMIN callers)', () => {
  it('SUPER_ADMIN sees everyone', () => {
    for (const target of ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'] as const) {
      expect(canSeeUser('SUPER_ADMIN', target)).toBe(true);
    }
  });

  it('other roles see every account except SUPER_ADMIN ones', () => {
    for (const actor of ['ADMIN', 'OPERATOR', 'VIEWER'] as const) {
      expect(canSeeUser(actor, 'SUPER_ADMIN')).toBe(false);
      expect(canSeeUser(actor, 'ADMIN')).toBe(true);
      expect(canSeeUser(actor, 'VIEWER')).toBe(true);
    }
  });
});

describe('assertAssignableRole', () => {
  it('SUPER_ADMIN may assign any role', () => {
    expect(() => assertAssignableRole('SUPER_ADMIN', 'SUPER_ADMIN')).not.toThrow();
    expect(() => assertAssignableRole('SUPER_ADMIN', 'VIEWER')).not.toThrow();
  });

  it('ADMIN may assign every role but SUPER_ADMIN ⇒ 403 SUPER_ADMIN_ACCOUNT_PROTECTED', () => {
    expect(() => assertAssignableRole('ADMIN', 'ADMIN')).not.toThrow();
    expect(() => assertAssignableRole('ADMIN', 'OPERATOR')).not.toThrow();
    const error = errorOf(() => assertAssignableRole('ADMIN', 'SUPER_ADMIN'));
    expect(error.getStatus()).toBe(403);
    expect(error.code).toBe('SUPER_ADMIN_ACCOUNT_PROTECTED');
  });
});

describe('assertGrantablePermissions', () => {
  it('non-reserved codes are fine for any role', () => {
    expect(() => assertGrantablePermissions('OPERATOR', ['alerts:view', 'users:read'])).not.toThrow();
  });

  it('a reserved code for a non-SUPER_ADMIN role ⇒ 400 PERMISSION_RESERVED_FOR_SUPER_ADMIN listing the codes', () => {
    const error = errorOf(() =>
      assertGrantablePermissions('ADMIN', ['users:read', 'audit:view', 'roles:manage']),
    );
    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe('PERMISSION_RESERVED_FOR_SUPER_ADMIN');
    expect(error.details).toEqual({ permissions: ['audit:view', 'roles:manage'] });
  });

  it('SUPER_ADMIN may hold reserved codes', () => {
    expect(() => assertGrantablePermissions('SUPER_ADMIN', ['audit:view', 'settings:manage'])).not.toThrow();
  });
});

describe('availableUserActions', () => {
  const companyAdmin = { id: 1n, roleCode: 'ADMIN' as const, permissions: [...ROLE_PERMISSIONS.ADMIN] };
  const viewer = { id: 2n, roleCode: 'VIEWER' as const, permissions: [...ROLE_PERMISSIONS.VIEWER] };
  const admin = { id: 3n, roleCode: 'SUPER_ADMIN' as const, permissions: [] };

  it('without users:manage there is nothing to do', () => {
    expect(availableUserActions(viewer, { id: 9n, status: 1 })).toEqual([]);
  });

  it('active account of someone else: edit, suspend, delete', () => {
    expect(availableUserActions(companyAdmin, { id: 9n, status: 1 })).toEqual(['edit', 'suspend', 'delete']);
  });

  it('suspended account: edit, restore, delete', () => {
    expect(availableUserActions(companyAdmin, { id: 9n, status: 2 })).toEqual(['edit', 'restore', 'delete']);
  });

  it('own row: edit only (no suspend / delete of yourself)', () => {
    expect(availableUserActions(companyAdmin, { id: 1n, status: 1 })).toEqual(['edit']);
  });

  it('SUPER_ADMIN bypasses the permission list', () => {
    expect(availableUserActions(admin, { id: 9n, status: 1 })).toEqual(['edit', 'suspend', 'delete']);
  });
});

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

describe('canSeeUser (DL55: ADMIN accounts are hidden from non-ADMIN callers)', () => {
  it('ADMIN sees everyone', () => {
    for (const target of ['ADMIN', 'COMPANY_ADMIN', 'OPERATOR', 'VIEWER'] as const) {
      expect(canSeeUser('ADMIN', target)).toBe(true);
    }
  });

  it('other roles see every account except ADMIN ones', () => {
    for (const actor of ['COMPANY_ADMIN', 'OPERATOR', 'VIEWER'] as const) {
      expect(canSeeUser(actor, 'ADMIN')).toBe(false);
      expect(canSeeUser(actor, 'COMPANY_ADMIN')).toBe(true);
      expect(canSeeUser(actor, 'VIEWER')).toBe(true);
    }
  });
});

describe('assertAssignableRole', () => {
  it('ADMIN may assign any role', () => {
    expect(() => assertAssignableRole('ADMIN', 'ADMIN')).not.toThrow();
    expect(() => assertAssignableRole('ADMIN', 'VIEWER')).not.toThrow();
  });

  it('COMPANY_ADMIN may assign every role but ADMIN ⇒ 403 ADMIN_ACCOUNT_PROTECTED', () => {
    expect(() => assertAssignableRole('COMPANY_ADMIN', 'COMPANY_ADMIN')).not.toThrow();
    expect(() => assertAssignableRole('COMPANY_ADMIN', 'OPERATOR')).not.toThrow();
    const error = errorOf(() => assertAssignableRole('COMPANY_ADMIN', 'ADMIN'));
    expect(error.getStatus()).toBe(403);
    expect(error.code).toBe('ADMIN_ACCOUNT_PROTECTED');
  });
});

describe('assertGrantablePermissions', () => {
  it('non-reserved codes are fine for any role', () => {
    expect(() => assertGrantablePermissions('OPERATOR', ['alerts:view', 'users:read'])).not.toThrow();
  });

  it('a reserved code for a non-ADMIN role ⇒ 400 PERMISSION_RESERVED_FOR_ADMIN listing the codes', () => {
    const error = errorOf(() =>
      assertGrantablePermissions('COMPANY_ADMIN', ['users:read', 'audit:view', 'roles:manage']),
    );
    expect(error.getStatus()).toBe(400);
    expect(error.code).toBe('PERMISSION_RESERVED_FOR_ADMIN');
    expect(error.details).toEqual({ permissions: ['audit:view', 'roles:manage'] });
  });

  it('ADMIN may hold reserved codes', () => {
    expect(() => assertGrantablePermissions('ADMIN', ['audit:view', 'settings:manage'])).not.toThrow();
  });
});

describe('availableUserActions', () => {
  const companyAdmin = { id: 1n, roleCode: 'COMPANY_ADMIN' as const, permissions: [...ROLE_PERMISSIONS.COMPANY_ADMIN] };
  const viewer = { id: 2n, roleCode: 'VIEWER' as const, permissions: [...ROLE_PERMISSIONS.VIEWER] };
  const admin = { id: 3n, roleCode: 'ADMIN' as const, permissions: [] };

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

  it('ADMIN bypasses the permission list', () => {
    expect(availableUserActions(admin, { id: 9n, status: 1 })).toEqual(['edit', 'suspend', 'delete']);
  });
});

import {
  RESERVED_SUPER_ADMIN_PERMISSIONS,
  type PermissionCode,
  type RoleCode,
} from '../../common/auth/permission-catalog';
import { AppException } from '../../common/errors/app-exception';
import { USER_STATUS } from '../auth/lockout';

// SUPER_ADMIN is our dev/ops super admin, not a customer role (DL55): its accounts are invisible to everyone
// else, and only SUPER_ADMIN may hand out the SUPER_ADMIN role or the SUPER_ADMIN-reserved permissions (DL51).

export function canSeeUser(actorRole: RoleCode, targetRole: string): boolean {
  return actorRole === 'SUPER_ADMIN' || targetRole !== 'SUPER_ADMIN';
}

export function assertAssignableRole(actorRole: RoleCode, roleCode: string): void {
  if (roleCode === 'SUPER_ADMIN' && actorRole !== 'SUPER_ADMIN') {
    throw new AppException(403, 'SUPER_ADMIN_ACCOUNT_PROTECTED', 'กำหนดบทบาทผู้ดูแลระบบสูงสุดได้เฉพาะผู้ดูแลระบบสูงสุด');
  }
}

export function assertGrantablePermissions(roleCode: string, codes: readonly PermissionCode[]): void {
  if (roleCode === 'SUPER_ADMIN') return;
  const reserved = codes.filter((c) => RESERVED_SUPER_ADMIN_PERMISSIONS.includes(c));
  if (reserved.length) {
    throw new AppException(400, 'PERMISSION_RESERVED_FOR_SUPER_ADMIN', 'สิทธิ์นี้สงวนไว้สำหรับผู้ดูแลระบบสูงสุด', {
      permissions: reserved,
    });
  }
}

export type UserAction = 'edit' | 'suspend' | 'restore' | 'delete';

/** Buttons the users page may show for a row (computed on the server). */
export function availableUserActions(
  actor: { id: bigint; roleCode: RoleCode; permissions: readonly PermissionCode[] },
  target: { id: bigint; status: number },
): UserAction[] {
  if (actor.roleCode !== 'SUPER_ADMIN' && !actor.permissions.includes('users:manage')) return [];
  const self = actor.id === target.id;
  const actions: UserAction[] = ['edit'];
  if (target.status === USER_STATUS.ACTIVE && !self) actions.push('suspend');
  if (target.status !== USER_STATUS.ACTIVE) actions.push('restore');
  if (!self) actions.push('delete');
  return actions;
}

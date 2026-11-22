import {
  RESERVED_ADMIN_PERMISSIONS,
  type PermissionCode,
  type RoleCode,
} from '../../common/auth/permission-catalog';
import { AppException } from '../../common/errors/app-exception';
import { USER_STATUS } from '../auth/lockout';

// ADMIN is our dev/ops super admin, not a customer role (DL55): its accounts are invisible to everyone
// else, and only ADMIN may hand out the ADMIN role or the ADMIN-reserved permissions (DL51).

export function canSeeUser(actorRole: RoleCode, targetRole: string): boolean {
  return actorRole === 'ADMIN' || targetRole !== 'ADMIN';
}

export function assertAssignableRole(actorRole: RoleCode, roleCode: string): void {
  if (roleCode === 'ADMIN' && actorRole !== 'ADMIN') {
    throw new AppException(403, 'ADMIN_ACCOUNT_PROTECTED', 'กำหนดบทบาทผู้ดูแลระบบได้เฉพาะผู้ดูแลระบบ');
  }
}

export function assertGrantablePermissions(roleCode: string, codes: readonly PermissionCode[]): void {
  if (roleCode === 'ADMIN') return;
  const reserved = codes.filter((c) => RESERVED_ADMIN_PERMISSIONS.includes(c));
  if (reserved.length) {
    throw new AppException(400, 'PERMISSION_RESERVED_FOR_ADMIN', 'สิทธิ์นี้สงวนไว้สำหรับผู้ดูแลระบบ', {
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
  if (actor.roleCode !== 'ADMIN' && !actor.permissions.includes('users:manage')) return [];
  const self = actor.id === target.id;
  const actions: UserAction[] = ['edit'];
  if (target.status === USER_STATUS.ACTIVE && !self) actions.push('suspend');
  if (target.status !== USER_STATUS.ACTIVE) actions.push('restore');
  if (!self) actions.push('delete');
  return actions;
}

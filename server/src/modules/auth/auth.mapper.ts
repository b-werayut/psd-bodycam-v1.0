import type { PermissionCode, RoleCode } from '../../common/auth/permission-catalog';

/** What the web client stores as the signed-in user (client `AuthUser` in stores/authStore.ts). */
export type AuthUserView = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
  roleCode: RoleCode;
  roleName: string;
  permissions: PermissionCode[];
};

export type UserWithRole = {
  Id: bigint;
  Username: string;
  FirstName: string;
  LastName: string;
  Email: string | null;
  RoleId: bigint;
  RoleCode: string;
  RoleName: string;
};

export function toAuthUserView(user: UserWithRole, permissions: PermissionCode[]): AuthUserView {
  return {
    id: user.Id.toString(),
    username: user.Username,
    firstName: user.FirstName,
    lastName: user.LastName,
    email: user.Email,
    roleCode: user.RoleCode as RoleCode,
    roleName: user.RoleName,
    permissions,
  };
}

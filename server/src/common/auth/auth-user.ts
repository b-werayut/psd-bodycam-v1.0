import type { PermissionCode, RoleCode } from './permission-catalog';

export type AuthUserLike = {
  id: bigint;
  username: string;
  roleId: bigint;
  roleCode: string;
};

/** The caller of a request, taken from the access token by JwtAuthGuard. */
export type AuthUser = AuthUserLike & {
  roleCode: RoleCode;
  permissions: PermissionCode[];
};

/** Access token claims. Ids are strings (JSON has no bigint). */
export type JwtPayload = {
  sub: string;
  username: string;
  roleId: string;
  roleCode: RoleCode;
  permissions: PermissionCode[];
};

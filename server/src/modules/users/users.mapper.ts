import type { AuthUser } from '../../common/auth/auth-user';
import { availableUserActions, type UserAction } from './admin-protection';

/** Shape of client `UserRow` (client/src/features/users/users.api.ts) + server-computed actions. */
export type UserRowView = {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  roleId: string;
  roleCode: string;
  roleName: string;
  status: number;
  lastLoginAt: string | null;
  azureLinked: boolean;
  availableActions: UserAction[];
};

export type UserJoinedRow = {
  Id: bigint;
  Username: string;
  FullName: string;
  Email: string | null;
  RoleId: bigint;
  RoleCode: string;
  RoleName: string;
  Status: number;
  LastLoginAt: Date | null;
  AzureObjectId: string | null;
};

export function toUserRow(row: UserJoinedRow, actor: AuthUser): UserRowView {
  return {
    id: row.Id.toString(),
    username: row.Username,
    fullName: row.FullName,
    email: row.Email,
    roleId: row.RoleId.toString(),
    roleCode: row.RoleCode,
    roleName: row.RoleName,
    status: row.Status,
    lastLoginAt: row.LastLoginAt?.toISOString() ?? null,
    azureLinked: row.AzureObjectId !== null,
    availableActions: availableUserActions(actor, { id: row.Id, status: row.Status }),
  };
}

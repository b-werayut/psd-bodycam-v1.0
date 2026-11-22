import { api } from '@/lib/apiClient';
import type { Paged } from '@/lib/paged';

export const USER_STATUS = { ACTIVE: 1, INACTIVE: 2, LOCKED: 3 } as const;

/** Row buttons the server allows for the caller (it decides; the page only shows them). */
export type UserAction = 'edit' | 'suspend' | 'restore' | 'delete';

export type UserRow = {
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

export type RoleRow = { id: string; code: string; name: string; isSystem: boolean };

/** GET /roles: the server leaves ADMIN out for non-ADMIN callers and lists the ADMIN-only codes. */
export type RolesResponse = { roles: RoleRow[]; reservedPermissions: string[] };

export type UserQuery = { page: number; pageSize: number; q?: string };

/** No password ⇒ an SSO-only account; `azureObjectId` links it to its Microsoft Entra account. */
export type CreateUserPayload = {
  username: string;
  fullName: string;
  roleCode: string;
  email?: string;
  password?: string;
  azureObjectId?: string;
};

export type UpdateUserPayload = {
  fullName?: string;
  email?: string | null;
  roleCode?: string;
  password?: string;
  /** null unlinks the Entra account */
  azureObjectId?: string | null;
};

export type EntraSyncConflictReason =
  | 'boundToAnotherAzureAccount'
  | 'duplicateUpnFromEntra'
  | 'ambiguousLocalMatch'
  | 'emailTakenOnApply';

/** One Microsoft Graph user as the server sends it (the page shows only some of these fields). */
export type EntraDirectoryUser = {
  id: string;
  userPrincipalName: string;
  displayName: string | null;
  mail: string | null;
  mobilePhone: string | null;
  accountEnabled: boolean | null;
  userType: string | null;
  givenName?: string | null;
  surname?: string | null;
  businessPhones?: string[];
  jobTitle?: string | null;
  department?: string | null;
  companyName?: string | null;
  officeLocation?: string | null;
  employeeId?: string | null;
  employeeType?: string | null;
  onPremisesSamAccountName?: string | null;
  createdDateTime?: string | null;
};

/** A local account the sync would fill (`patch`, PascalCase column names) or leaves as is (`keptLocal`). */
export type EntraSyncUpdate = {
  userId: string;
  username: string;
  upn: string;
  patch: Partial<Record<'AzureObjectId' | 'Email' | 'FullName', string>>;
  keptLocal: string[];
};

export type EntraSyncConflict = {
  upn: string;
  username: string;
  reason: EntraSyncConflictReason;
  detail: string;
};

/** GET /users/entra-directory and POST /users/sync-entra. The sync never creates accounts. */
export type EntraSyncResult = {
  dryRun: boolean;
  entraTotal: number;
  entraFetched: number;
  entraDroppedByDomain: number;
  filteredAtGraph: boolean;
  allowedDomains: string[];
  domainFilteredAtGraph: boolean;
  domainField: string;
  applied: number;
  unchanged: number;
  updates: EntraSyncUpdate[];
  missingInSystem: { upn: string; displayName: string | null; oid: string }[];
  notInEntra: { username: string; email: string | null }[];
  conflicts: EntraSyncConflict[];
  entraUsers: EntraDirectoryUser[];
  entraFields: string[];
};

export type EntraSyncPayload = { dryRun: boolean; matchByUsername?: boolean };

export const usersApi = {
  list: (query: UserQuery) =>
    api
      .get<Paged<UserRow>>('/users', {
        params: { page: query.page, pageSize: query.pageSize, ...(query.q ? { q: query.q } : {}) },
      })
      .then((r) => r.data),
  create: (payload: CreateUserPayload) => api.post<UserRow>('/users', payload).then((r) => r.data),
  update: (id: string, payload: UpdateUserPayload) =>
    api.patch<UserRow>(`/users/${id}`, payload).then((r) => r.data),
  setAccess: (id: string, enabled: boolean) =>
    api.patch(`/users/${id}/access`, { enabled }).then((r) => r.data),
  remove: (id: string) => api.delete(`/users/${id}`).then((r) => r.data),
  /** Dry run: compares the Entra directory with Users and writes nothing (`users:manage`). */
  entraDirectory: () =>
    api.get<EntraSyncResult>('/users/entra-directory').then((r) => r.data),
  syncEntra: (payload: EntraSyncPayload) =>
    api.post<EntraSyncResult>('/users/sync-entra', payload).then((r) => r.data),
};

export const rolesApi = {
  list: (): Promise<RolesResponse> =>
    api
      .get<{ data: RoleRow[]; total: number; reservedPermissions?: string[] }>('/roles')
      .then((r) => ({ roles: r.data.data, reservedPermissions: r.data.reservedPermissions ?? [] })),
  permissions: (id: string) =>
    api.get<{ data: string[]; total: number }>(`/roles/${id}/permissions`).then((r) => r.data.data),
  savePermissions: (id: string, permissions: string[]) =>
    api.put(`/roles/${id}/permissions`, { permissions }).then((r) => r.data),
};

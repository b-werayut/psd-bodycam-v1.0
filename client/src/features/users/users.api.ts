import { api } from '@/lib/apiClient';
import type { Paged } from '@/lib/paged';

export const USER_STATUS = { ACTIVE: 1, INACTIVE: 2, LOCKED: 3 } as const;

export type UserRow = {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  roleId: string;
  roleCode: string;
  roleName: string;
  departmentId: string | null;
  departmentName: string | null;
  status: number;
  lastLoginAt: string | null;
  azureLinked: boolean;
};

export type RoleRow = { id: string; code: string; name: string; isSystem: boolean };

export type UserQuery = { page: number; pageSize: number; q?: string };

export type CreateUserPayload = {
  username: string;
  fullName: string;
  roleCode: string;
  email?: string;
  password?: string;
  departmentId?: string;
};

export type UpdateUserPayload = {
  fullName?: string;
  email?: string | null;
  roleCode?: string;
  departmentId?: string | null;
  password?: string;
};

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
};

export const rolesApi = {
  list: () => api.get<{ data: RoleRow[]; total: number }>('/roles').then((r) => r.data.data),
  permissions: (id: string) =>
    api.get<{ data: string[]; total: number }>(`/roles/${id}/permissions`).then((r) => r.data.data),
  savePermissions: (id: string, permissions: string[]) =>
    api.put(`/roles/${id}/permissions`, { permissions }).then((r) => r.data),
};

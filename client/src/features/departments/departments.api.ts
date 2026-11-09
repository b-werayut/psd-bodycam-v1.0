import { api } from '@/lib/apiClient';
import type { ApiErrorInfo } from '@/lib/apiError';

export type DepartmentNode = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
  children: DepartmentNode[];
};

export type CreateDepartmentPayload = { code: string; name: string; parentId?: string };
export type UpdateDepartmentPayload = {
  code?: string;
  name?: string;
  parentId?: string | null;
  isActive?: boolean;
};

export const DEPARTMENTS_TREE_KEY = ['departments', 'tree'] as const;

export const departmentsApi = {
  tree: () =>
    api
      .get<{ data: DepartmentNode[]; total: number }>('/departments/tree')
      .then((r) => r.data.data),
  create: (payload: CreateDepartmentPayload) =>
    api.post<DepartmentNode>('/departments', payload).then((r) => r.data),
  update: (id: string, payload: UpdateDepartmentPayload) =>
    api.patch<DepartmentNode>(`/departments/${id}`, payload).then((r) => r.data),
  remove: (id: string) => api.delete(`/departments/${id}`).then((r) => r.data),
};

export function flattenDepartments(
  nodes: DepartmentNode[],
  depth = 0,
): Array<{ id: string; label: string }> {
  return nodes.flatMap((node) => [
    { id: node.id, label: `${'— '.repeat(depth)}${node.name} (${node.code})` },
    ...flattenDepartments(node.children, depth + 1),
  ]);
}

export type DepartmentInUseDetails = { children: number; employees: number };

/** Counts from `details` of a 409 DEPARTMENT_IN_USE error, or null for any other error. */
export function departmentInUseDetails(info: ApiErrorInfo): DepartmentInUseDetails | null {
  if (info.status !== 409 || info.code !== 'DEPARTMENT_IN_USE') return null;
  const details = (info.details && typeof info.details === 'object' ? info.details : {}) as {
    children?: unknown;
    employees?: unknown;
  };
  return {
    children: Number(details.children ?? 0),
    employees: Number(details.employees ?? 0),
  };
}

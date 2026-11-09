import { api } from '@/lib/apiClient';
import type { Paged } from '@/lib/paged';

export const EMPLOYEE_STATUS = { ACTIVE: 1, SUSPENDED: 2, RESIGNED: 3 } as const;

export type EmployeeRow = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  departmentId: string;
  departmentName: string | null;
  userId: string | null;
  bookingEmployeeRef: string | null;
  status: number;
};

export type EmployeeFilters = {
  page: number;
  pageSize: number;
  q?: string;
  departmentId?: string;
  status?: number;
};

export type CreateEmployeePayload = {
  employeeCode: string;
  firstName: string;
  lastName: string;
  departmentId: string;
  phone?: string;
  userId?: string;
  bookingEmployeeRef?: string;
};

export type UpdateEmployeePayload = {
  employeeCode?: string;
  firstName?: string;
  lastName?: string;
  departmentId?: string;
  phone?: string | null;
  userId?: string | null;
  bookingEmployeeRef?: string | null;
  status?: number;
};

export const employeesApi = {
  list: (filters: EmployeeFilters) =>
    api
      .get<Paged<EmployeeRow>>('/employees', {
        params: {
          page: filters.page,
          pageSize: filters.pageSize,
          ...(filters.q ? { q: filters.q } : {}),
          ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
          ...(filters.status ? { status: filters.status } : {}),
        },
      })
      .then((r) => r.data),
  create: (payload: CreateEmployeePayload) =>
    api.post<EmployeeRow>('/employees', payload).then((r) => r.data),
  update: (id: string, payload: UpdateEmployeePayload) =>
    api.patch<EmployeeRow>(`/employees/${id}`, payload).then((r) => r.data),
  remove: (id: string) => api.delete(`/employees/${id}`).then((r) => r.data),
};

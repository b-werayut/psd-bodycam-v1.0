import { api } from '@/lib/apiClient';
import type { Paged } from '@/lib/paged';

export const AUDIT_RESULT = { SUCCESS: 1, FAILURE: 2 } as const;

export type AuditRow = {
  id: string;
  occurredAt: string;
  userId: string | null;
  actorUsername: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  result: number;
  httpMethod: string | null;
  requestPath: string | null;
  ip: string | null;
  correlationId: string | null;
};

export type AuditFilters = {
  page: number;
  pageSize: number;
  search?: string;
  userId?: string;
  action?: string;
  resourceType?: string;
  result?: number;
  /** ISO8601 */
  from?: string;
  /** ISO8601 */
  to?: string;
};

export const auditApi = {
  list: (filters: AuditFilters) =>
    api
      .get<Paged<AuditRow>>('/audit-logs', {
        params: {
          page: filters.page,
          pageSize: filters.pageSize,
          ...(filters.search ? { search: filters.search } : {}),
          ...(filters.userId ? { userId: filters.userId } : {}),
          ...(filters.action ? { action: filters.action } : {}),
          ...(filters.resourceType ? { resourceType: filters.resourceType } : {}),
          ...(filters.result ? { result: filters.result } : {}),
          ...(filters.from ? { from: filters.from } : {}),
          ...(filters.to ? { to: filters.to } : {}),
        },
      })
      .then((r) => r.data),
  actions: () =>
    api.get<{ data: string[]; total: number }>('/audit-logs/actions').then((r) => r.data.data),
};

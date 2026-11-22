import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, lt, or, type SQL } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { AuditLogs } from '../../db/schema.partitioned';
import type { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/** Shape of client `AuditRow` (client/src/features/audit/audit.api.ts). */
export type AuditRowView = {
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

@Injectable()
export class AuditLogsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async list(q: QueryAuditLogsDto) {
    const where = and(...filters(q));
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(AuditLogs)
        .where(where)
        .orderBy(desc(AuditLogs.OccurredAt), desc(AuditLogs.Id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(AuditLogs).where(where),
    ]);
    return { data: rows.map(toView), page: q.page, pageSize: q.pageSize, total: Number(total) };
  }

  async actions(): Promise<{ data: string[]; total: number }> {
    const rows = await this.db
      .selectDistinct({ action: AuditLogs.Action })
      .from(AuditLogs)
      .orderBy(asc(AuditLogs.Action));
    return { data: rows.map((r) => r.action), total: rows.length };
  }
}

function filters(q: QueryAuditLogsDto): SQL[] {
  const out: SQL[] = [];
  if (q.userId) out.push(eq(AuditLogs.UserId, BigInt(q.userId)));
  if (q.action) out.push(eq(AuditLogs.Action, q.action));
  if (q.resourceType) out.push(eq(AuditLogs.ResourceType, q.resourceType));
  if (q.result) out.push(eq(AuditLogs.Result, q.result));
  if (q.from) out.push(gte(AuditLogs.OccurredAt, new Date(q.from)));
  if (q.to) out.push(lt(AuditLogs.OccurredAt, new Date(q.to)));
  const search = q.search?.trim();
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    out.push(
      or(
        ilike(AuditLogs.ActorUsername, like),
        ilike(AuditLogs.Action, like),
        ilike(AuditLogs.ResourceType, like),
        ilike(AuditLogs.RequestPath, like),
        ilike(AuditLogs.CorrelationId, like),
      ) as SQL,
    );
  }
  return out;
}

function toView(row: typeof AuditLogs.$inferSelect): AuditRowView {
  return {
    id: row.Id.toString(),
    occurredAt: row.OccurredAt.toISOString(),
    userId: row.UserId?.toString() ?? null,
    actorUsername: row.ActorUsername,
    actorRole: row.ActorRole,
    action: row.Action,
    resourceType: row.ResourceType,
    resourceId: row.ResourceId?.toString() ?? null,
    result: row.Result,
    httpMethod: row.HttpMethod,
    requestPath: row.RequestPath,
    ip: row.Ip,
    correlationId: row.CorrelationId,
  };
}

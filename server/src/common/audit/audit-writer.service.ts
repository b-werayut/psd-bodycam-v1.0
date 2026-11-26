import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { AuditLogs } from '../../db/schema.partitioned';
import { getContext } from '../context/request-context';

export type AuditEntry = {
  action: string;
  result: 1 | 2;
  resourceType?: string | null;
  resourceId?: bigint | null;
  userId?: bigint | null;
  actorUsername?: string | null;
  actorRole?: string | null;
  changes?: unknown;
  httpMethod?: string | null;
  requestPath?: string | null;
};

/**
 * Fire-and-forget insert into AuditLogs. A failed write is logged, never thrown: the audit trail must
 * not break the request it describes. Correlation id, IP and user agent come from the request context.
 */
@Injectable()
export class AuditWriterService {
  private readonly logger = new Logger(AuditWriterService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  write(entry: AuditEntry): void {
    void this.insert(entry);
  }

  /** Same as write() but awaitable (tests and shutdown paths). */
  async insert(entry: AuditEntry): Promise<void> {
    const ctx = getContext();
    try {
      await this.db.insert(AuditLogs).values({
        UserId: entry.userId ?? ctx?.userId ?? null,
        ActorUsername: (entry.actorUsername ?? ctx?.user?.username ?? null)?.slice(0, 50) ?? null,
        ActorRole: entry.actorRole ?? ctx?.user?.roleCode ?? null,
        Action: entry.action,
        ResourceType: entry.resourceType ?? null,
        ResourceId: entry.resourceId ?? null,
        Changes: entry.changes ?? null,
        HttpMethod: entry.httpMethod ?? null,
        RequestPath: entry.requestPath?.slice(0, 300) ?? null,
        Result: entry.result,
        Ip: ctx?.ip?.slice(0, 45) ?? null,
        UserAgent: ctx?.userAgent?.slice(0, 300) ?? null,
        CorrelationId: ctx?.correlationId ?? null,
      });
    } catch (error) {
      this.logger.error(`Failed to write AuditLogs (${entry.action}): ${error instanceof Error ? error.message : error}`);
    }
  }
}

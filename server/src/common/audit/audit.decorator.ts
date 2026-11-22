import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'auditMeta';

export type AuditMeta = { action: string; resourceType?: string };

/** Writes an AuditLogs row for this handler (success = Result 1, error = Result 2). */
export const Audit = (action: string, resourceType?: string) =>
  SetMetadata(AUDIT_KEY, { action, resourceType } satisfies AuditMeta);

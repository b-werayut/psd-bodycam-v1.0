import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import type { AuthUser } from '../auth/auth-user';
import { AUDIT_KEY, type AuditMeta } from './audit.decorator';
import { redactBody } from './audit-redact';
import { AuditWriterService } from './audit-writer.service';

/** Global interceptor: handlers marked @Audit get one AuditLogs row per call. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly writer: AuditWriterService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const meta = this.reflector.get<AuditMeta | undefined>(AUDIT_KEY, context.getHandler());
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const record = (result: 1 | 2, handlerResult?: unknown) =>
      this.writer.write({
        action: meta.action,
        resourceType: meta.resourceType ?? null,
        resourceId: resourceId(handlerResult, req),
        userId: req.user?.id ?? null,
        actorUsername: req.user?.username ?? null,
        actorRole: req.user?.roleCode ?? null,
        changes: redactBody(req.body),
        httpMethod: req.method,
        requestPath: req.originalUrl ?? req.url,
        result,
      });

    return next.handle().pipe(
      tap((handlerResult) => record(1, handlerResult)),
      catchError((error) => {
        record(2);
        return throwError(() => error);
      }),
    );
  }
}

function resourceId(result: unknown, req: Request): bigint | null {
  const raw = (result as { id?: unknown } | null | undefined)?.id ?? (req.params as Record<string, string>)?.id;
  if (raw === undefined || raw === null) return null;
  try {
    return BigInt(raw as string | number | bigint);
  } catch {
    return null;
  }
}

import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { from, Observable, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { getCorrelationId } from '../../../common/context/request-context';
import { excerptOf, safeErrorSummary,InboundCallLogService } from './inbound-call-log.service';

/** Logs the outcome of the route handler (2xx / 400 / 503). Guard rejections are logged by the guard itself. */
@Injectable()
export class InboundCallLogInterceptor implements NestInterceptor {
  constructor(private readonly callLog: InboundCallLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { rawBody?: Buffer }>();
    const res = http.getResponse<Response>();
    const startedAt = Date.now();
    const log = (httpStatus: number, errorMessage?: string) =>
      this.callLog.record({
        httpStatus,
        latencyMs: Date.now() - startedAt,
        correlationId: getCorrelationId() ?? null,
        errorMessage,
        requestExcerpt: excerptOf(req.rawBody),
      });

    return next.handle().pipe(
      // Awaited, so the row exists before the response is sent.
      mergeMap(async (value) => {
        await log(res.statusCode);
        return value;
      }),
      catchError((err: unknown) => {
        const status = err instanceof HttpException ? err.getStatus() : 500;
        return from(log(status, safeErrorSummary(err))).pipe(mergeMap(() => throwError(() => err)));
      }),
    );
  }
}

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { requestContext, resolveCorrelationId } from './request-context';

export const CORRELATION_HEADER = 'X-Correlation-Id';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = resolveCorrelationId(req);
    res.setHeader(CORRELATION_HEADER, correlationId);
    (req as Request & { id?: string }).id = correlationId;
    requestContext.run(
      { correlationId, userId: undefined, ip: req.ip, userAgent: req.headers['user-agent'] },
      () => next(),
    );
  }
}

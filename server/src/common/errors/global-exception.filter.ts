import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { getCorrelationId } from '../context/request-context';
import { AppException } from './app-exception';
import { ERROR_CODE_BY_STATUS } from './error-codes';

const INTERNAL_MESSAGE = 'เกิดข้อผิดพลาดภายในระบบ';

interface Envelope {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  correlationId: string;
}

interface BodyParserError {
  type?: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const correlationId =
      getCorrelationId() ?? (res.getHeader?.('X-Correlation-Id') as string | undefined) ?? 'unknown';

    const body = this.toEnvelope(exception, correlationId, req);
    if (res.headersSent) return;
    res.status(body.statusCode).json(body);
  }

  private toEnvelope(exception: unknown, correlationId: string, req: Request): Envelope {
    if (exception instanceof AppException) {
      const env: Envelope = {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        correlationId,
      };
      if (exception.details !== undefined) env.details = exception.details;
      return env;
    }

    const bp = exception as BodyParserError | null;
    if (bp && typeof bp === 'object' && typeof bp.type === 'string') {
      if (bp.type === 'entity.too.large') {
        return { statusCode: 413, code: 'PAYLOAD_TOO_LARGE', message: 'ขนาดข้อมูลที่ส่งมาใหญ่เกินกำหนด', correlationId };
      }
      if (bp.type === 'entity.parse.failed') {
        return { statusCode: 400, code: 'BAD_REQUEST', message: 'รูปแบบ JSON ไม่ถูกต้อง', correlationId };
      }
    }

    if (exception instanceof BadRequestException) {
      const response = exception.getResponse();
      const raw =
        typeof response === 'object' && response !== null ? (response as { message?: unknown }).message : undefined;
      if (Array.isArray(raw)) {
        return {
          statusCode: 400,
          code: 'VALIDATION_FAILED',
          message: 'ข้อมูลที่ส่งมาไม่ถูกต้อง',
          details: { messages: raw },
          correlationId,
        };
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        statusCode: status,
        code: ERROR_CODE_BY_STATUS[status] ?? 'ERROR',
        message: exception.message,
        correlationId,
      };
    }

    const err = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(`[${correlationId}] ${req.method} ${req.url}: ${err.message}`, err.stack);
    return { statusCode: 500, code: 'INTERNAL_ERROR', message: INTERNAL_MESSAGE, correlationId };
  }
}

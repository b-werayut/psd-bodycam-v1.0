import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { getCorrelationId } from '../../../common/context/request-context';
import { AppException } from '../../../common/errors/app-exception';
import { BOOKING_INBOUND_MAX_BYTES, type RawBodyRequest } from '../../../common/http/route-raw-body';
import { BOOKING_INBOUND_CONFIG } from '../booking-integration.constants';
import type { BookingInboundConfig } from './booking-inbound.config';
import { checkInboundAuth } from './inbound-auth';
import { excerptOf, InboundCallLogService } from './inbound-call-log.service';

export const MAX_INBOUND_BYTES = BOOKING_INBOUND_MAX_BYTES;

/** Route guard: 415 (not JSON) → 413 (over 256 KB) → 401 (auth). Logs every rejection itself. */
@Injectable()
export class BookingInboundAuthGuard implements CanActivate {
  private readonly logger = new Logger(BookingInboundAuthGuard.name);

  constructor(
    @Inject(BOOKING_INBOUND_CONFIG) private readonly cfg: BookingInboundConfig,
    private readonly callLog: InboundCallLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & RawBodyRequest>();
    const startedAt = Date.now();

    const reject = async (status: number, code: string, message: string, reason: string): Promise<never> => {
      await this.callLog.record({
        httpStatus: status,
        latencyMs: Date.now() - startedAt,
        correlationId: getCorrelationId() ?? null,
        errorMessage: `${code}: ${reason}`,
        requestExcerpt: excerptOf(req.rawBody),
      });
      throw new AppException(status, code, message);
    };

    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (contentType !== 'application/json') {
      return reject(415, 'UNSUPPORTED_MEDIA_TYPE', 'รับเฉพาะ application/json', 'content-type');
    }

    const rawBody = req.rawBody ?? Buffer.alloc(0);
    if (req.bodyTooLarge || rawBody.length > MAX_INBOUND_BYTES) {
      return reject(413, 'PAYLOAD_TOO_LARGE', 'ขนาดข้อมูลที่ส่งมาใหญ่เกินกำหนด (สูงสุด 256 KB)', req.bodyTooLarge ? 'over limit' : `${rawBody.length} bytes`);
    }

    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v[0] : v;
    const auth = checkInboundAuth({ headers, rawBody, ip: req.ip ?? '', nowMs: Date.now() }, this.cfg);
    if (!auth.ok) {
      this.logger.warn(`inbound auth failed: ${auth.reason} (ip ${req.ip})`);
      return reject(401, 'INBOUND_AUTH_FAILED', 'ยืนยันตัวตนไม่ผ่าน', `auth:${auth.reason}`);
    }
    // Parsed here (not by the global parser) so malformed JSON is call-logged; the signature was checked on the raw bytes.
    try {
      req.body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      await this.callLog.record({
        httpStatus: 400,
        latencyMs: Date.now() - startedAt,
        correlationId: getCorrelationId() ?? null,
        errorMessage: 'VALIDATION_FAILED: JSON ไม่ถูกต้อง',
        requestExcerpt: excerptOf(rawBody),
      });
      throw new AppException(400, 'VALIDATION_FAILED', 'ข้อมูลที่ส่งมาไม่ถูกต้อง', [
        { field: 'body', issue: 'ไม่ใช่ JSON ที่ถูกต้อง' },
      ]);
    }
    return true;
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE } from '../../../db/db.constants';
import type { DrizzleDB } from '../../../db/db.types';
import { IntegrationCallLogs } from '../../../db/schema';

export const BOOKING_SOURCE = 'BOOKING';
const EXCERPT_MAX = 4096;

export type InboundCallLogEntry = {
  httpStatus: number;
  latencyMs: number;
  correlationId: string | null;
  errorMessage?: string;
  requestExcerpt?: string;
};

/** Cuts text to at most `max` UTF-8 bytes without splitting a multi-byte character. */
export function capUtf8(text: string, max = EXCERPT_MAX): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= max) return text;
  let end = max;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

/** Excerpt of a request body for the call log: at most 4 KB (bytes), never headers. */
export function excerptOf(body: Buffer | string | undefined): string | undefined {
  if (body === undefined) return undefined;
  const text = typeof body === 'string' ? body : body.subarray(0, EXCERPT_MAX * 2).toString('utf8');
  return capUtf8(text);
}

/** Error summary that is safe to log: drizzle query errors carry the SQL params (the whole body) in their message. */
export function safeErrorSummary(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { message?: string } } | null;
  const message = e?.cause?.message ?? e?.message ?? String(err);
  return `${e?.name ?? 'Error'}: ${message}`.slice(0, 300);
}

/** Writes `IntegrationCallLogs` rows for the inbound endpoint. Never throws. */
@Injectable()
export class InboundCallLogService {
  private readonly logger = new Logger(InboundCallLogService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async record(entry: InboundCallLogEntry): Promise<void> {
    try {
      await this.db.insert(IntegrationCallLogs).values({
        Source: BOOKING_SOURCE,
        Direction: 2,
        Operation: 'inbound.job',
        HttpMethod: 'POST',
        HttpStatus: entry.httpStatus,
        LatencyMs: Math.max(0, Math.round(entry.latencyMs)),
        CorrelationId: entry.correlationId?.slice(0, 64) ?? null,
        Outcome: entry.httpStatus < 400 ? 1 : 2,
        ErrorMessage: entry.errorMessage?.slice(0, 1000) ?? null,
        RequestExcerpt: entry.requestExcerpt === undefined ? null : capUtf8(entry.requestExcerpt),
      });
    } catch (err) {
      this.logger.warn(`Failed to record call log: ${safeErrorSummary(err)}`);
    }
  }
}

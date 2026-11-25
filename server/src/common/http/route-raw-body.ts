import express, { type NextFunction, type Request, type Response } from 'express';

export const BOOKING_INBOUND_PATH = '/api/integration/booking/jobs';
export const BOOKING_INBOUND_MAX_BYTES = 262_144;

export type RawBodyRequest = Request & { rawBody?: Buffer; bodyTooLarge?: boolean; _body?: boolean };

const rawParser = express.raw({ type: () => true, limit: BOOKING_INBOUND_MAX_BYTES });

/**
 * Reads the Booking inbound body as raw bytes (limit 256 KB) before the global JSON parser, which then skips it.
 * Nothing is rejected here: an oversize body only sets `bodyTooLarge`, so the route guard can answer 413 and write the call log.
 */
export function bookingInboundRawBody(req: Request, res: Response, next: NextFunction): void {
  const r = req as RawBodyRequest;
  rawParser(req, res, (err?: unknown) => {
    if (err) {
      if ((err as { type?: string }).type === 'entity.too.large') {
        r.bodyTooLarge = true;
        r._body = true;
        r.body = undefined;
        return next();
      }
      return next(err);
    }
    r._body = true;
    r.rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    next();
  });
}

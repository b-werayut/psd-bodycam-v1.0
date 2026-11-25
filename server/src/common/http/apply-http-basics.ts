import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { BOOKING_INBOUND_PATH, bookingInboundRawBody } from './route-raw-body';

export const BODY_LIMIT = '1mb';

/** Shared HTTP wiring (prefix, body limits, validation) used by main.api.ts and tests. */
export function applyHttpBasics(app: INestApplication): void {
  const express = app as unknown as NestExpressApplication;
  // Registered first: the Booking inbound route reads its own raw body (256 KB); the parsers below skip it.
  express.use(BOOKING_INBOUND_PATH, (req: never, res: never, next: never) => {
    if ((req as { method: string }).method !== 'POST') return (next as () => void)();
    bookingInboundRawBody(req, res, next);
  });
  // useBodyParser keeps Nest's rawBody capture when the app is created with rawBody: true.
  express.useBodyParser('json', { limit: BODY_LIMIT });
  express.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
}

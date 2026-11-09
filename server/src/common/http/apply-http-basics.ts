import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

export const BODY_LIMIT = '1mb';

/** Shared HTTP wiring (prefix, body limits, validation) used by main.api.ts and tests. */
export function applyHttpBasics(app: INestApplication): void {
  const express = app as unknown as NestExpressApplication;
  // useBodyParser keeps Nest's rawBody capture when the app is created with rawBody: true.
  express.useBodyParser('json', { limit: BODY_LIMIT });
  express.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
}

import { INestApplication, Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { corsOrigins } from '../common/config/cors';
import { resolveTrustProxy } from '../common/config/trust-proxy';
import { applyHttpBasics } from '../common/http/apply-http-basics';

/**
 * HTTP wiring shared by main.api.ts and the integration-test harness: trust proxy, CORS,
 * global prefix, validation pipe and body limits. Logger and shutdown hooks stay in main.api.ts.
 */
export async function configureApp(app: INestApplication): Promise<void> {
  const trustProxy = resolveTrustProxy(process.env);
  if (trustProxy.error) Logger.error(trustProxy.error, 'Bootstrap');
  (app as NestExpressApplication).set('trust proxy', trustProxy.value);

  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
    exposedHeaders: ['Content-Disposition', 'X-Correlation-Id'],
  });

  applyHttpBasics(app);
  return Promise.resolve();
}

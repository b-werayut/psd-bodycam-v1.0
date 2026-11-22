import { INestApplication, Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { corsOrigins } from '../common/config/cors';
import { resolveTrustProxy } from '../common/config/trust-proxy';
import { applyHttpBasics } from '../common/http/apply-http-basics';
import { isSwaggerEnabled, setupSwagger } from './swagger';

/**
 * HTTP wiring shared by main.api.ts and the integration-test harness: trust proxy, security headers,
 * CORS, global prefix, validation pipe, body limits and Swagger. Logger, the Socket.IO adapter and
 * shutdown hooks stay in main.api.ts.
 */
export async function configureApp(app: INestApplication): Promise<void> {
  const trustProxy = resolveTrustProxy(process.env);
  if (trustProxy.error) Logger.error(trustProxy.error, 'Bootstrap');
  (app as NestExpressApplication).set('trust proxy', trustProxy.value);

  // The SPA is served by nginx (its own headers); CSP here would only break Swagger UI.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
    exposedHeaders: ['Content-Disposition', 'X-Correlation-Id'],
  });

  applyHttpBasics(app);
  if (isSwaggerEnabled(process.env)) setupSwagger(app);
  return Promise.resolve();
}

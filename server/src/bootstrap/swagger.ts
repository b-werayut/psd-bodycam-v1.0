import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** On outside production; production only with SWAGGER_ENABLED=true. SWAGGER_ENABLED=false turns it off anywhere. */
export function isSwaggerEnabled(env: NodeJS.ProcessEnv): boolean {
  const flag = (env.SWAGGER_ENABLED ?? '').trim().toLowerCase();
  if (flag === 'false') return false;
  if (flag === 'true') return true;
  return env.NODE_ENV !== 'production';
}

/**
 * Swagger UI at /api/docs, JSON at /api/docs-json. Call after the global prefix is set: paths already
 * include /api, so no addServer('/api') (it would double the prefix in "Try it out").
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('PSD Body Worn Camera API')
    .setDescription('REST API ของระบบกล้องบันทึกภาพ (Bodycam) — กด Authorize แล้วใส่ access token จาก POST /api/auth/login')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' });
}

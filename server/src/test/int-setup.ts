import 'dotenv/config';
import 'reflect-metadata';
import { installBigIntJson } from '../common/bigint-json';
import { redact, resolveTestDbTarget } from './test-db-url';

const target = resolveTestDbTarget();
process.env.DATABASE_URL = target.url;

installBigIntJson();

process.env.AUTH_PASSWORD_LOGIN_ENABLED = 'true';
process.env.AZURE_AD_TENANT_ID = '11111111-2222-3333-4444-555555555555';
process.env.AZURE_AD_CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// Rate limits must never interfere with tests (rate-limit tests set their own low values).
for (const key of [
  'AUTH_LOGIN_RATE_LIMIT_PER_MIN',
  'AUTH_SSO_RATE_LIMIT_PER_MIN',
  'AUTH_REFRESH_RATE_LIMIT_PER_MIN',
  'WEBHOOK_RATE_LIMIT_PER_MIN',
]) {
  process.env[key] = '100000';
}

if (process.env.VITEST_INT_VERBOSE) {
  console.log(`[int-test] DATABASE_URL = ${redact(target.url)}`);
}

import 'dotenv/config';
import 'reflect-metadata';
import { installBigIntJson } from '../common/bigint-json';
import { redact, resolveTestDbTarget } from './test-db-url';

const target = resolveTestDbTarget();
process.env.DATABASE_URL = target.url;

installBigIntJson();

// Simulator only: the tests expect its 100 `SIM-*` cameras and must never reach the real DSS
// that a dev `.env` may point at (`DSS_DRIVER=dss`).
process.env.DSS_DRIVER = 'mock';
delete process.env.DSS_MOCK_DEVICES;

process.env.AUTH_PASSWORD_LOGIN_ENABLED = 'true';
process.env.AZURE_AD_TENANT_ID = '11111111-2222-3333-4444-555555555555';
process.env.AZURE_AD_CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// Rate limits must never interfere with tests (rate-limit tests set their own low values).
for (const key of [
  'AUTH_LOGIN_RATE_LIMIT_PER_MIN',
  'AUTH_SSO_RATE_LIMIT_PER_MIN',
  'AUTH_REFRESH_RATE_LIMIT_PER_MIN',
  'WEBHOOK_RATE_LIMIT_PER_MIN',
  'BOOKING_INBOUND_RATE_LIMIT_PER_MIN',
]) {
  process.env[key] = '100000';
}

process.env.BOOKING_INBOUND_SECRETS = 'test-secret-1,test-secret-2';

if (process.env.VITEST_INT_VERBOSE) {
  console.log(`[int-test] DATABASE_URL = ${redact(target.url)}`);
}

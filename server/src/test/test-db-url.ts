import { redactUrl } from '../common/config/redact-url';

export type TestDbTarget = {
  url: string;
  database: string;
  adminUrl: string;
};

const TEST_SUFFIX = '_test';

export function resolveTestDbTarget(env: NodeJS.ProcessEnv = process.env): TestDbTarget {
  const devUrl = env.DATABASE_URL;
  const explicit = env.DATABASE_URL_TEST;
  if (!devUrl && !explicit) {
    throw new Error('DATABASE_URL or DATABASE_URL_TEST must be set in .env first');
  }

  const raw = explicit ?? deriveTestUrl(devUrl as string);
  const parsed = new URL(raw);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

  if (!database) throw new Error(`test database URL has no database name: ${redact(raw)}`);
  if (!database.endsWith(TEST_SUFFIX)) {
    throw new Error(
      `test database name must end with '${TEST_SUFFIX}' (got '${database}') - this prevents running integration tests against a real DB by accident`,
    );
  }
  if (devUrl && raw === devUrl) {
    throw new Error('DATABASE_URL_TEST must not be the same as DATABASE_URL');
  }

  const admin = new URL(raw);
  admin.pathname = '/postgres';
  return { url: raw, database, adminUrl: admin.toString() };
}

function deriveTestUrl(devUrl: string): string {
  const parsed = new URL(devUrl);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  parsed.pathname = `/${database}${TEST_SUFFIX}`;
  return parsed.toString();
}

export const redact = redactUrl;

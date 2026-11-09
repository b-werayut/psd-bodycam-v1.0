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
    throw new Error('ต้องตั้ง DATABASE_URL หรือ DATABASE_URL_TEST ใน .env ก่อน');
  }

  const raw = explicit ?? deriveTestUrl(devUrl as string);
  const parsed = new URL(raw);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

  if (!database) throw new Error(`test database URL ไม่มีชื่อ database: ${redact(raw)}`);
  if (!database.endsWith(TEST_SUFFIX)) {
    throw new Error(
      `ชื่อ test database ต้องลงท้าย '${TEST_SUFFIX}' (ได้ '${database}') — กันเผลอรัน integration test ทับ DB จริง`,
    );
  }
  if (devUrl && raw === devUrl) {
    throw new Error('DATABASE_URL_TEST ต้องไม่ใช่ตัวเดียวกับ DATABASE_URL');
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

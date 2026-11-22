import { Logger } from '@nestjs/common';
import postgres from 'postgres';
import { redactUrl } from '../common/config/redact-url';
import { checkMigrations } from './migration-check';
import {
  describeMigrationStatus,
  resolveMigrationCheckMode,
  type MigrationReport,
} from './migration-status';

const CONTEXT = 'MigrationCheck';
const CONNECT_TIMEOUT_SECONDS = 10;

export interface MigrationGuardResult {
  blocked: boolean;
  report: MigrationReport;
}

export async function checkMigrationsForBoot(
  env: NodeJS.ProcessEnv = process.env,
): Promise<MigrationGuardResult | null> {
  const { mode, error } = resolveMigrationCheckMode(env);
  if (error) Logger.error(error, CONTEXT);
  if (mode === 'off') {
    Logger.warn(
      'DB_MIGRATION_CHECK=off — ข้ามการตรวจ schema · schema ที่ไม่ตรงจะกลายเป็น 500 ตอนใช้งานแทน',
      CONTEXT,
    );
    return null;
  }

  const url = (env.DATABASE_URL ?? '').trim();
  if (!url) {
    Logger.error('ไม่ได้ตั้ง DATABASE_URL — ตรวจ schema ไม่ได้', CONTEXT);
    return null;
  }

  const sql = postgres(url, {
    max: 1,
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    onnotice: () => undefined,
  });
  try {
    const status = await checkMigrations(sql, env);
    const report = describeMigrationStatus(status);
    return { blocked: mode === 'enforce' && report.level === 'fail', report };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    Logger.warn(
      `ตรวจ schema ไม่สำเร็จ (${redactUrl(url)}): ${message} — ปล่อยให้ขึ้นต่อ ` +
        'เพราะพิสูจน์ไม่ได้ว่า schema ไม่ตรง',
      CONTEXT,
    );
    return null;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function guardMigrationsOrExit(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const result = await checkMigrationsForBoot(env);
  if (!result) return;

  const { blocked, report } = result;
  const [summary, ...details] = report.lines;

  if (report.level === 'ok') {
    Logger.log(summary, CONTEXT);
    return;
  }

  const log =
    report.level === 'fail'
      ? (line: string) => Logger.error(line, CONTEXT)
      : (line: string) => Logger.warn(line, CONTEXT);
  log(summary);
  for (const line of details) log(line);

  if (blocked) {
    Logger.error(
      'ไม่สตาร์ตโปรเซส — ลง migration ให้ครบก่อน (หรือตั้ง DB_MIGRATION_CHECK=warn ' +
        'ชั่วคราวถ้าจำเป็นต้องให้ระบบขึ้นก่อน)',
      CONTEXT,
    );
    process.exit(1);
  }

  if (report.level === 'fail') {
    Logger.warn('DB_MIGRATION_CHECK=warn — ขึ้นระบบต่อทั้งที่ schema ไม่ตรง', CONTEXT);
  }
}

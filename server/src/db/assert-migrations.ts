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
      'DB_MIGRATION_CHECK=off - schema check skipped · a schema mismatch will surface as 500 errors at runtime instead',
      CONTEXT,
    );
    return null;
  }

  const url = (env.DATABASE_URL ?? '').trim();
  if (!url) {
    Logger.error('DATABASE_URL is not set - cannot check the schema', CONTEXT);
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
      `Schema check failed (${redactUrl(url)}): ${message} - continuing to start ` +
        'because a schema mismatch cannot be proven',
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
      'Not starting the process - apply all migrations first (or set DB_MIGRATION_CHECK=warn ' +
        'temporarily if the system must come up first)',
      CONTEXT,
    );
    process.exit(1);
  }

  if (report.level === 'fail') {
    Logger.warn('DB_MIGRATION_CHECK=warn - starting even though the schema does not match', CONTEXT);
  }
}

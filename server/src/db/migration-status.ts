
export interface MigrationRef {
  hash: string;
  folderMillis: number;
  tag: string;
}

export interface AppliedMigration {
  hash: string;
  createdAt: number;
}

export type MigrationVerdict =
  | 'ok'
  | 'pending'
  | 'skipped'
  | 'journal-missing'
  | 'no-files';

export interface MigrationStatus {
  verdict: MigrationVerdict;
  pending: MigrationRef[];
  skipped: MigrationRef[];
  ahead: number;
  fileCount: number;
  appliedCount: number;
}

export function compareMigrations(
  files: MigrationRef[],
  applied: AppliedMigration[] | null,
): MigrationStatus {
  const base: MigrationStatus = {
    verdict: 'ok',
    pending: [],
    skipped: [],
    ahead: 0,
    fileCount: files.length,
    appliedCount: applied?.length ?? 0,
  };

  if (files.length === 0) return { ...base, verdict: 'no-files' };
  if (applied === null) return { ...base, verdict: 'journal-missing' };

  const appliedHashes = new Set(applied.map((row) => row.hash));
  const fileHashes = new Set(files.map((file) => file.hash));

  const newestApplied = applied.reduce(
    (max, row) => (row.createdAt > max ? row.createdAt : max),
    Number.NEGATIVE_INFINITY,
  );

  const pending: MigrationRef[] = [];
  const skipped: MigrationRef[] = [];
  for (const file of files) {
    if (appliedHashes.has(file.hash)) continue;
    if (file.folderMillis > newestApplied) pending.push(file);
    else skipped.push(file);
  }

  const byTime = (a: MigrationRef, b: MigrationRef) =>
    a.folderMillis - b.folderMillis;
  pending.sort(byTime);
  skipped.sort(byTime);

  const ahead = applied.filter((row) => !fileHashes.has(row.hash)).length;

  const verdict: MigrationVerdict =
    skipped.length > 0 ? 'skipped' : pending.length > 0 ? 'pending' : 'ok';

  return { ...base, verdict, pending, skipped, ahead };
}

export interface MigrationReport {
  level: 'ok' | 'warn' | 'fail';
  lines: string[];
}

const MIGRATE_CMD = 'cd server && DATABASE_URL="<prod>" npm run db:migrate';

function names(refs: MigrationRef[]): string {
  return refs.map((ref) => ref.tag).join(', ');
}

export function describeMigrationStatus(status: MigrationStatus): MigrationReport {
  switch (status.verdict) {
    case 'ok': {
      const lines = [
        `schema matches the image (${status.appliedCount} migrations applied out of ${status.fileCount} files)`,
      ];
      if (status.ahead > 0) {
        lines.push(
          `the database has ${status.ahead} migrations that this image does not contain - ` +
            'usually means a code rollback after migrating; safe to continue, but be aware',
        );
        return { level: 'warn', lines };
      }
      return { level: 'ok', lines };
    }

    case 'pending':
      return {
        level: 'fail',
        lines: [
          `the database is missing ${status.pending.length} migrations: ${names(status.pending)}`,
          'the schema does not match the code in this image - starting anyway will cause 500 errors on queries that touch the new columns',
          `fix: ${MIGRATE_CMD}`,
        ],
      };

    case 'skipped':
      return {
        level: 'fail',
        lines: [
          `${status.skipped.length} migrations were permanently skipped: ${names(status.skipped)}`,
          'their hashes are not in the database but their timestamps are older than the latest applied one - ' +
            'drizzle selects by timestamp, so it will never run them; `db:migrate` cannot repair this',
          'fix: run the SQL of those files against the database yourself and record the hashes in ' +
            'drizzle.__drizzle_migrations (or regenerate them so the timestamps move forward)',
          ...(status.pending.length > 0
            ? [`(${status.pending.length} more are pending as usual: ${names(status.pending)})`]
            : []),
        ],
      };

    case 'journal-missing':
      return {
        level: 'fail',
        lines: [
          'table drizzle.__drizzle_migrations not found - this database has never been through the migrator',
          'empty database: just run npm run db:migrate',
          'database that already has tables but never went through the migrator: compare the schema by hand first; ' +
            'never mark a migration as applied without actually running it',
        ],
      };

    case 'no-files':
      return {
        level: 'warn',
        lines: [
          'no migration files found in the image - cannot check the schema',
          'the image must include the drizzle/ folder (with meta/_journal.json)',
        ],
      };
  }
}

export type MigrationCheckMode =
  | 'enforce'
  | 'warn'
  | 'off';

export const MIGRATION_CHECK_DEFAULT: MigrationCheckMode = 'enforce';

const OFF = new Set(['off', 'false', 'no', '0']);
const WARN = new Set(['warn', 'warning']);
const ENFORCE = new Set(['enforce', 'true', 'yes', '1', 'strict']);

export function resolveMigrationCheckMode(
  env: NodeJS.ProcessEnv,
): { mode: MigrationCheckMode; error?: string } {
  const raw = (env.DB_MIGRATION_CHECK ?? '').trim().toLowerCase();
  if (!raw) return { mode: MIGRATION_CHECK_DEFAULT };
  if (OFF.has(raw)) return { mode: 'off' };
  if (WARN.has(raw)) return { mode: 'warn' };
  if (ENFORCE.has(raw)) return { mode: 'enforce' };
  return {
    mode: MIGRATION_CHECK_DEFAULT,
    error:
      `DB_MIGRATION_CHECK='${raw}' is not recognized - only enforce | warn | off are valid · ` +
      `falling back to '${MIGRATION_CHECK_DEFAULT}'`,
  };
}

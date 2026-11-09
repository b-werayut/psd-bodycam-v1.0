import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { Sql } from 'postgres';
import {
  compareMigrations,
  type AppliedMigration,
  type MigrationRef,
  type MigrationStatus,
} from './migration-status';

export const MIGRATIONS_TABLE = 'drizzle.__drizzle_migrations';

interface JournalEntry {
  when: number;
  tag: string;
}

export function resolveMigrationsFolder(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const candidates = [
    (env.DB_MIGRATIONS_DIR ?? '').trim() || null,
    resolve(process.cwd(), 'drizzle'),
    resolve(__dirname, '..', '..', 'drizzle'),
  ].filter((path): path is string => path !== null);

  for (const folder of candidates) {
    if (existsSync(join(folder, 'meta', '_journal.json'))) return folder;
  }
  return null;
}

export function readLocalMigrations(folder: string | null): MigrationRef[] {
  if (folder === null) return [];

  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries?: JournalEntry[];
  };
  const entries = journal.entries ?? [];

  return readMigrationFiles({ migrationsFolder: folder }).map((file, index) => ({
    hash: file.hash,
    folderMillis: file.folderMillis,
    tag: entries[index]?.tag ?? `(ลำดับที่ ${index})`,
  }));
}

export async function readAppliedMigrations(
  sql: Sql,
): Promise<AppliedMigration[] | null> {
  const [probe] = await sql<{ present: boolean }[]>`
    select to_regclass('drizzle.__drizzle_migrations') is not null as present`;
  if (!probe?.present) return null;

  const rows = await sql<{ hash: string; created_at: string | number | null }[]>`
    select hash, created_at from drizzle.__drizzle_migrations`;
  return rows.map((row) => ({
    hash: row.hash,
    createdAt: Number(row.created_at ?? 0),
  }));
}

export async function checkMigrations(
  sql: Sql,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MigrationStatus> {
  const files = readLocalMigrations(resolveMigrationsFolder(env));
  if (files.length === 0) return compareMigrations(files, null);
  return compareMigrations(files, await readAppliedMigrations(sql));
}

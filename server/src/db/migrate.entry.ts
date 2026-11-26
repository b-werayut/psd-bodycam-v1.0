import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { redactUrl } from '../common/config/redact-url';
import {
  readAppliedMigrations,
  readLocalMigrations,
  resolveMigrationsFolder,
} from './migration-check';
import { compareMigrations, describeMigrationStatus } from './migration-status';

const LOCK_KEY = 728_401_991;
const LOCK_POLL_MS = 1_000;

function waitSeconds(env: NodeJS.ProcessEnv): number {
  const raw = Number(env.DB_MIGRATE_LOCK_WAIT_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 120;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function acquireLock(
  sql: postgres.Sql,
  maxWaitSeconds: number,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitSeconds * 1000;
  let waited = false;
  for (;;) {
    const [row] = await sql<{ got: boolean }[]>`
      select pg_try_advisory_lock(${LOCK_KEY}) as got`;
    if (row?.got) return true;
    if (Date.now() >= deadline) return false;
    if (!waited) {
      console.log('- another process is applying migrations - waiting');
      waited = true;
    }
    await sleep(LOCK_POLL_MS);
  }
}

async function main(): Promise<void> {
  const url = (process.argv[2] ?? process.env.DATABASE_URL ?? '').trim();
  if (!url) throw new Error('DATABASE_URL not found (or pass the URL as an argument)');

  const folder = resolveMigrationsFolder();
  if (folder === null) {
    throw new Error(
      'Migrations folder not found (drizzle/meta/_journal.json is required) - ' +
        'the image must include the drizzle/ folder, or point to it with DB_MIGRATIONS_DIR',
    );
  }

  console.log(`database: ${redactUrl(url)}`);
  console.log(`migrations: ${folder}`);

  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  let locked = false;
  try {
    locked = await acquireLock(sql, waitSeconds(process.env));
    if (!locked) {
      throw new Error(
        `Waited more than ${waitSeconds(process.env)} seconds for the advisory lock - ` +
          'another process is stuck applying migrations · check that none is left hanging',
      );
    }

    const files = readLocalMigrations(folder);
    const before = compareMigrations(files, await readAppliedMigrations(sql));

    if (before.verdict === 'skipped') {
      for (const line of describeMigrationStatus(before).lines) console.error(`  ${line}`);
      throw new Error('Some migrations were permanently skipped by the migrator - fix by hand first');
    }
    if (before.pending.length === 0) {
      console.log(`- already up to date (${before.appliedCount} migrations), nothing to apply`);
      return;
    }

    console.log(`- ${before.pending.length} to apply:`);
    for (const ref of before.pending) console.log(`    ${ref.tag}`);

    await migrate(drizzle(sql), { migrationsFolder: folder });

    const after = compareMigrations(files, await readAppliedMigrations(sql));
    if (after.pending.length > 0 || after.skipped.length > 0) {
      for (const line of describeMigrationStatus(after).lines) console.error(`  ${line}`);
      throw new Error('Migrations applied but the set is still incomplete');
    }
    console.log(`- all applied (${after.appliedCount} migrations in total)`);
  } finally {
    if (locked) await sql`select pg_advisory_unlock(${LOCK_KEY})`;
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

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
      console.log('- โปรเซสอื่นกำลังลง migration อยู่ — รอคิว');
      waited = true;
    }
    await sleep(LOCK_POLL_MS);
  }
}

async function main(): Promise<void> {
  const url = (process.argv[2] ?? process.env.DATABASE_URL ?? '').trim();
  if (!url) throw new Error('ไม่พบ DATABASE_URL (หรือส่ง URL มาเป็น argument)');

  const folder = resolveMigrationsFolder();
  if (folder === null) {
    throw new Error(
      'ไม่พบโฟลเดอร์ migration (ต้องมี drizzle/meta/_journal.json) — ' +
        'image ต้อง copy โฟลเดอร์ drizzle/ เข้าไปด้วย หรือชี้ด้วย DB_MIGRATIONS_DIR',
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
        `รอ advisory lock เกิน ${waitSeconds(process.env)} วินาที — ` +
          'มีโปรเซสอื่นค้างอยู่ระหว่างลง migration · ตรวจก่อนว่าไม่มีใครลงค้างไว้',
      );
    }

    const files = readLocalMigrations(folder);
    const before = compareMigrations(files, await readAppliedMigrations(sql));

    if (before.verdict === 'skipped') {
      for (const line of describeMigrationStatus(before).lines) console.error(`  ${line}`);
      throw new Error('มี migration ที่ migrator ข้ามถาวร — ต้องแก้ด้วยมือก่อน');
    }
    if (before.pending.length === 0) {
      console.log(`- ครบอยู่แล้ว (${before.appliedCount} migration) ไม่มีอะไรต้องลง`);
      return;
    }

    console.log(`- ต้องลง ${before.pending.length} ตัว:`);
    for (const ref of before.pending) console.log(`    ${ref.tag}`);

    await migrate(drizzle(sql), { migrationsFolder: folder });

    const after = compareMigrations(files, await readAppliedMigrations(sql));
    if (after.pending.length > 0 || after.skipped.length > 0) {
      for (const line of describeMigrationStatus(after).lines) console.error(`  ${line}`);
      throw new Error('ลง migration แล้วแต่ยังไม่ครบ');
    }
    console.log(`- ลงครบแล้ว (รวม ${after.appliedCount} migration)`);
  } finally {
    if (locked) await sql`select pg_advisory_unlock(${LOCK_KEY})`;
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

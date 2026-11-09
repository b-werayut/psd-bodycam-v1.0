import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { redact, resolveTestDbTarget } from '../src/test/test-db-url';

async function ensureDatabase(): Promise<void> {
  const target = resolveTestDbTarget();
  console.log(`test database: ${redact(target.url)}`);

  const admin = postgres(target.adminUrl, { max: 1 });
  try {
    const rows = await admin`select 1 from pg_database where datname = ${target.database}`;
    if (rows.length) {
      console.log(`- database '${target.database}' already exists`);
    } else {
      await admin.unsafe(`CREATE DATABASE "${target.database}"`);
      console.log(`- created database '${target.database}'`);
    }
  } finally {
    await admin.end();
  }
}

function run(label: string, command: string, args: string[], url: string): void {
  console.log(`- ${label}...`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: url },
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status ?? 'null'})`);
  }
}

async function main(): Promise<void> {
  await ensureDatabase();
  const { url } = resolveTestDbTarget();
  // No seed: integration tests seed their own rows.
  run('drizzle-kit migrate', 'npx', ['drizzle-kit', 'migrate'], url);
  console.log('test database ready - run `npm run test:int`');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

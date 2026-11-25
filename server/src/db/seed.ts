import 'dotenv/config';
import postgres from 'postgres';
import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_DEMO_PASSWORD,
  SEED_USERS,
  assertSeedAllowed,
  runDevSeed,
} from './dev-seed';

// `npm run db:seed` — dev only. Run `npm run db:migrate` first (roles come from the migration).

async function main(): Promise<void> {
  assertSeedAllowed(process.env);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('ไม่ได้ตั้ง DATABASE_URL');

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const result = await runDevSeed(sql, process.env);
    console.log(`seed เสร็จ: ผู้ใช้ ${result.users} บัญชี`);
    for (const u of SEED_USERS) {
      const source =
        u.role === 'SUPER_ADMIN'
          ? `SEED_ADMIN_PASSWORD (ไม่ตั้ง = ${DEFAULT_ADMIN_PASSWORD})`
          : `SEED_DEMO_PASSWORD (ไม่ตั้ง = ${DEFAULT_DEMO_PASSWORD})`;
      console.log(`  ${u.username.padEnd(14)} ${u.role.padEnd(14)} รหัสผ่าน: ${source}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

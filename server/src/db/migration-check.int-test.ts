import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkMigrationsForBoot } from './assert-migrations';

const DRIZZLE_DIR = join(__dirname, '..', '..', 'drizzle');

describe('migration drift guard at boot', () => {
  let tmp: string;

  beforeAll(() => {
    // Copy of server/drizzle plus one journal entry the test DB has never applied.
    tmp = mkdtempSync(join(tmpdir(), 'bwc-migrations-'));
    cpSync(DRIZZLE_DIR, tmp, { recursive: true });
    const journalPath = join(tmp, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    journal.entries.push({ idx: 99, version: '7', when: Date.now(), tag: '9999_future', breakpoints: true });
    writeFileSync(journalPath, JSON.stringify(journal));
    writeFileSync(join(tmp, '9999_future.sql'), 'select 1;');
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('is ok on the migrated test DB', async () => {
    expect(await checkMigrationsForBoot({ ...process.env, DB_MIGRATION_CHECK: 'enforce' })).toMatchObject({
      blocked: false,
      report: { level: 'ok' },
    });
  });

  it('enforce blocks when a journal entry is not applied', async () => {
    expect(
      await checkMigrationsForBoot({ ...process.env, DB_MIGRATION_CHECK: 'enforce', DB_MIGRATIONS_DIR: tmp }),
    ).toMatchObject({ blocked: true, report: { level: 'fail' } });
  });

  it('warn reports but does not block', async () => {
    const result = await checkMigrationsForBoot({ ...process.env, DB_MIGRATION_CHECK: 'warn', DB_MIGRATIONS_DIR: tmp });
    expect(result?.blocked).toBe(false);
    expect(result?.report.level).toBe('fail');
  });

  it('off skips the check', async () => {
    expect(await checkMigrationsForBoot({ ...process.env, DB_MIGRATION_CHECK: 'off' })).toBeNull();
  });
});

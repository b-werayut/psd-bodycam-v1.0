import { describe, expect, it } from 'vitest';
import {
  MIGRATION_CHECK_DEFAULT,
  compareMigrations,
  describeMigrationStatus,
  resolveMigrationCheckMode,
  type AppliedMigration,
  type MigrationRef,
} from './migration-status';

const file = (tag: string, folderMillis: number, hash = `h-${tag}`): MigrationRef => ({
  tag,
  folderMillis,
  hash,
});
const applied = (ref: MigrationRef): AppliedMigration => ({
  hash: ref.hash,
  createdAt: ref.folderMillis,
});

const M0 = file('0000_base', 1_000);
const M1 = file('0001_next', 2_000);
const M2 = file('0002_new', 3_000);

describe('compareMigrations', () => {
  it('ตรงกันครบ = ok', () => {
    const status = compareMigrations([M0, M1], [applied(M0), applied(M1)]);
    expect(status.verdict).toBe('ok');
    expect(status.pending).toEqual([]);
    expect(status.skipped).toEqual([]);
    expect(status.appliedCount).toBe(2);
    expect(status.fileCount).toBe(2);
  });

  it('ไฟล์ที่ใหม่กว่าตัวล่าสุดใน DB = pending (db:migrate ลงให้ได้)', () => {
    const status = compareMigrations([M0, M1, M2], [applied(M0), applied(M1)]);
    expect(status.verdict).toBe('pending');
    expect(status.pending.map((r) => r.tag)).toEqual(['0002_new']);
    expect(status.skipped).toEqual([]);
  });

  it('database ว่าง (ตารางมีแต่ยังไม่มีแถว) = ทุกไฟล์ pending ไม่ใช่ skipped', () => {
    const status = compareMigrations([M0, M1], []);
    expect(status.verdict).toBe('pending');
    expect(status.pending.map((r) => r.tag)).toEqual(['0000_base', '0001_next']);
    expect(status.skipped).toEqual([]);
  });

  it('hash หายแต่เวลาเก่ากว่าตัวล่าสุด = skipped เพราะ migrator เลือกจากเวลา', () => {
    const status = compareMigrations([M0, M1, M2], [applied(M0), applied(M2)]);
    expect(status.verdict).toBe('skipped');
    expect(status.skipped.map((r) => r.tag)).toEqual(['0001_next']);
    expect(status.pending).toEqual([]);
  });

  it('มีทั้ง skipped และ pending = ตัดสินเป็น skipped (ร้ายแรงกว่า) แต่เก็บทั้งสองกอง', () => {
    const M3 = file('0003_later', 4_000);
    const status = compareMigrations([M0, M1, M2, M3], [applied(M0), applied(M2)]);
    expect(status.verdict).toBe('skipped');
    expect(status.skipped.map((r) => r.tag)).toEqual(['0001_next']);
    expect(status.pending.map((r) => r.tag)).toEqual(['0003_later']);
  });

  it('เรียง pending ตามเวลา ไม่ตามลำดับที่ส่งเข้ามา', () => {
    const status = compareMigrations([M2, M0, M1], []);
    expect(status.pending.map((r) => r.tag)).toEqual([
      '0000_base',
      '0001_next',
      '0002_new',
    ]);
  });

  it('applied = null (ยังไม่มีตาราง) ต่างจาก [] — ได้ journal-missing', () => {
    const status = compareMigrations([M0], null);
    expect(status.verdict).toBe('journal-missing');
    expect(status.pending).toEqual([]);
  });

  it('ไม่มีไฟล์เลย = no-files ตรวจไม่ได้', () => {
    expect(compareMigrations([], [applied(M0)]).verdict).toBe('no-files');
    expect(compareMigrations([], null).verdict).toBe('no-files');
  });

  it('DB มี hash ที่ image ไม่มี = นับเป็น ahead แต่ยังถือว่า ok', () => {
    const status = compareMigrations([M0, M1], [applied(M0), applied(M1), applied(M2)]);
    expect(status.verdict).toBe('ok');
    expect(status.ahead).toBe(1);
  });

  it('เนื้อไฟล์เปลี่ยนหลังลงไปแล้ว (hash ต่างแต่เวลาเดิม) = skipped', () => {
    const edited = file('0001_next', 2_000, 'h-edited');
    const status = compareMigrations([M0, edited], [applied(M0), applied(M1)]);
    expect(status.verdict).toBe('skipped');
    expect(status.skipped.map((r) => r.tag)).toEqual(['0001_next']);
  });
});

describe('describeMigrationStatus', () => {
  it('ok = level ok และไม่มีคำสั่งให้ทำอะไร', () => {
    const report = describeMigrationStatus(
      compareMigrations([M0], [applied(M0)]),
    );
    expect(report.level).toBe('ok');
    expect(report.lines).toHaveLength(1);
  });

  it('pending = fail พร้อมชื่อ migration และคำสั่งแก้', () => {
    const report = describeMigrationStatus(
      compareMigrations([M0, M2], [applied(M0)]),
    );
    expect(report.level).toBe('fail');
    expect(report.lines[0]).toContain('0002_new');
    expect(report.lines.join('\n')).toContain('db:migrate');
  });

  it('skipped = fail และบอกว่า db:migrate ซ่อมให้ไม่ได้', () => {
    const report = describeMigrationStatus(
      compareMigrations([M0, M1, M2], [applied(M0), applied(M2)]),
    );
    expect(report.level).toBe('fail');
    expect(report.lines[0]).toContain('0001_next');
    expect(report.lines.join('\n')).toContain('ซ่อมให้ไม่ได้');
  });

  it('journal-missing = fail · บอกให้ db:migrate และไม่แนะนำ baseline (ระบบนี้ไม่มีสคริปต์นั้น)', () => {
    const report = describeMigrationStatus(compareMigrations([M0], null));
    expect(report.level).toBe('fail');
    const text = report.lines.join('\n');
    expect(text).toContain('db:migrate');
    expect(text).not.toContain('db:baseline');
  });

  it('no-files = warn เท่านั้น (ตรวจไม่ได้ ไม่ใช่ schema ผิด)', () => {
    expect(describeMigrationStatus(compareMigrations([], null)).level).toBe('warn');
  });

  it('DB ใหม่กว่า image = warn ไม่บล็อก เพราะ rollback ต้องทำได้', () => {
    const report = describeMigrationStatus(
      compareMigrations([M0], [applied(M0), applied(M2)]),
    );
    expect(report.level).toBe('warn');
    expect(report.lines.join('\n')).toContain('rollback');
  });
});

describe('resolveMigrationCheckMode', () => {
  it('ไม่ตั้งค่า = enforce', () => {
    expect(resolveMigrationCheckMode({}).mode).toBe('enforce');
    expect(MIGRATION_CHECK_DEFAULT).toBe('enforce');
  });

  it('อ่านค่าที่รองรับได้ ไม่สนตัวพิมพ์/ช่องว่าง', () => {
    expect(resolveMigrationCheckMode({ DB_MIGRATION_CHECK: ' OFF ' }).mode).toBe('off');
    expect(resolveMigrationCheckMode({ DB_MIGRATION_CHECK: 'warn' }).mode).toBe('warn');
    expect(resolveMigrationCheckMode({ DB_MIGRATION_CHECK: 'Enforce' }).mode).toBe(
      'enforce',
    );
    expect(resolveMigrationCheckMode({ DB_MIGRATION_CHECK: 'false' }).mode).toBe('off');
  });

  it('ค่าที่อ่านไม่ออก = ถอยไป enforce พร้อมบอกเหตุ ไม่เงียบ', () => {
    const result = resolveMigrationCheckMode({ DB_MIGRATION_CHECK: 'maybe' });
    expect(result.mode).toBe('enforce');
    expect(result.error).toContain('maybe');
  });
});

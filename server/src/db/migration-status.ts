
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
        `schema ตรงกับ image (ลงแล้ว ${status.appliedCount} migration จาก ${status.fileCount} ไฟล์)`,
      ];
      if (status.ahead > 0) {
        lines.push(
          `database มี migration ที่ image นี้ไม่มีอยู่ ${status.ahead} ตัว — ` +
            'ปกติแปลว่าเพิ่ง rollback โค้ดหลัง migrate ไปแล้ว ปล่อยผ่านได้ แต่ควรรู้ตัว',
        );
        return { level: 'warn', lines };
      }
      return { level: 'ok', lines };
    }

    case 'pending':
      return {
        level: 'fail',
        lines: [
          `database ขาด migration ${status.pending.length} ตัว: ${names(status.pending)}`,
          'schema ไม่ตรงกับโค้ดใน image นี้ — ปล่อยให้ขึ้นระบบจะได้ 500 ตอน query ที่แตะคอลัมน์ใหม่',
          `แก้: ${MIGRATE_CMD}`,
        ],
      };

    case 'skipped':
      return {
        level: 'fail',
        lines: [
          `migration ${status.skipped.length} ตัวถูกข้ามถาวร: ${names(status.skipped)}`,
          'hash ไม่อยู่ใน database แต่เวลาเก่ากว่าตัวล่าสุดที่ลงแล้ว — ' +
            'drizzle เลือกจากเวลา จึงจะไม่รันตัวเหล่านี้อีกเลย `db:migrate` ซ่อมให้ไม่ได้',
          'แก้: ลง SQL ของไฟล์เหล่านั้นกับ database เอง แล้วบันทึก hash ลง ' +
            'drizzle.__drizzle_migrations (หรือ generate ใหม่ให้เวลาเดินหน้า)',
          ...(status.pending.length > 0
            ? [`(ยังมีตัวที่รอลงตามปกติอีก ${status.pending.length}: ${names(status.pending)})`]
            : []),
        ],
      };

    case 'journal-missing':
      return {
        level: 'fail',
        lines: [
          'ไม่พบตาราง drizzle.__drizzle_migrations — database นี้ยังไม่เคยผ่าน migrator',
          'database ว่าง: รัน npm run db:migrate ตรง ๆ',
          'database ที่มีตารางอยู่แล้วแต่ไม่เคยผ่าน migrator: ตรวจเทียบ schema ด้วยมือก่อน ' +
            'ห้าม mark migration ว่าลงแล้วโดยไม่ได้รันจริง',
        ],
      };

    case 'no-files':
      return {
        level: 'warn',
        lines: [
          'ไม่พบไฟล์ migration ใน image — ตรวจ schema ไม่ได้',
          'image ต้อง copy โฟลเดอร์ drizzle/ (รวม meta/_journal.json) เข้าไปด้วย',
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
      `DB_MIGRATION_CHECK='${raw}' อ่านไม่ออก — ใช้ได้เฉพาะ enforce | warn | off · ` +
      `ตอนนี้ถอยไปใช้ '${MIGRATION_CHECK_DEFAULT}'`,
  };
}

import { describe, expect, it } from 'vitest';

import {
  conflictReasonKey,
  directoryColumns,
  entraDirectoryRows,
  entraSyncCounts,
  fieldLabelKey,
  filterDirectoryRows,
  hasEntraChanges,
  paginateDirectory,
  plannedWrites,
  rowStatusKey,
  rowStatusTone,
  scopeNotes,
  DIRECTORY_COLUMNS,
} from './entraSync';
import type { EntraDirectoryUser, EntraSyncResult, EntraSyncUpdate } from './users.api';

const result = (over: Partial<EntraSyncResult> = {}): EntraSyncResult => ({
  dryRun: true,
  entraTotal: 3,
  entraFetched: 3,
  entraDroppedByDomain: 0,
  filteredAtGraph: true,
  allowedDomains: [],
  domainFilteredAtGraph: false,
  domainField: 'userPrincipalName',
  applied: 0,
  unchanged: 1,
  updates: [],
  missingInSystem: [],
  notInEntra: [],
  conflicts: [],
  entraUsers: [],
  entraFields: [],
  ...over,
});

const update = (over: Partial<EntraSyncUpdate> = {}): EntraSyncUpdate => ({
  userId: '1',
  username: 'somchai',
  upn: 'somchai@psd.co.th',
  patch: { Email: 'somchai@psd.co.th' },
  keptLocal: [],
  ...over,
});

describe('plannedWrites / hasEntraChanges', () => {
  it('แถวที่ patch ว่าง = "ต่างกันแต่ไม่แตะ" ไม่นับเป็นของที่จะเขียน', () => {
    const r = result({ updates: [update({ patch: {}, keptLocal: ['Email'] })] });

    expect(plannedWrites(r)).toHaveLength(0);
    expect(hasEntraChanges(r)).toBe(false);
  });

  it('มีช่องให้เติม = นับ', () => {
    expect(hasEntraChanges(result({ updates: [update()] }))).toBe(true);
  });

  it('conflicts / missingInSystem / notInEntra ไม่ทำให้ปุ่มอัปเดตกดได้', () => {
    const r = result({
      conflicts: [{ upn: 'a@x', username: 'a', reason: 'ambiguousLocalMatch', detail: '' }],
      missingInSystem: [{ upn: 'b@x', displayName: null, oid: 'o' }],
      notInEntra: [{ username: 'admin', email: null }],
    });
    expect(hasEntraChanges(r)).toBe(false);
  });
});

describe('entraSyncCounts', () => {
  it('โหมดดูแผน = นับจำนวนที่จะเขียน', () => {
    const counts = entraSyncCounts(result({ updates: [update()] }));
    expect(counts.update).toBe(1);
    expect(counts.entraTotal).toBe(3);
  });

  it('หลังเขียนจริง = ใช้ค่า applied จาก server ไม่นับเอง', () => {
    const counts = entraSyncCounts(result({ dryRun: false, applied: 5, updates: [update()] }));
    expect(counts.update).toBe(5);
  });

  it('นับ missing / notInEntra / conflicts จากรายการ', () => {
    const counts = entraSyncCounts(
      result({
        missingInSystem: [{ upn: 'b@x', displayName: null, oid: 'o' }],
        notInEntra: [
          { username: 'a', email: null },
          { username: 'b', email: null },
        ],
        conflicts: [{ upn: 'a@x', username: 'a', reason: 'ambiguousLocalMatch', detail: '' }],
      }),
    );
    expect(counts).toMatchObject({ missingInSystem: 1, notInEntra: 2, conflicts: 1, unchanged: 1 });
  });
});

describe('fieldLabelKey', () => {
  it('ชื่อช่องที่ server เติม/คงค่า แปลงเป็น i18n key', () => {
    expect(fieldLabelKey('AzureObjectId')).toBe('users.entraSync.patchField.AzureObjectId');
    expect(fieldLabelKey('Email')).toBe('users.entraSync.patchField.Email');
    expect(fieldLabelKey('FirstName')).toBe('users.entraSync.patchField.FirstName');
  });

  it('ช่องที่ไม่รู้จัก = null ให้หน้าจอแสดงชื่อดิบ', () => {
    expect(fieldLabelKey('Phone')).toBe('users.entraSync.patchField.Phone');
    expect(fieldLabelKey('UnknownField')).toBeNull();
  });
});

describe('conflictReasonKey', () => {
  it('แปลงเหตุผลที่รู้จักเป็น i18n key', () => {
    expect(conflictReasonKey('boundToAnotherAzureAccount')).toBe(
      'users.entraSync.conflict.boundToAnotherAzureAccount',
    );
    expect(conflictReasonKey('emailTakenOnApply')).toBe(
      'users.entraSync.conflict.emailTakenOnApply',
    );
  });

  it('ค่าที่ server รุ่นใหม่กว่าส่งมาต้องไม่ทำให้หน้าพัง', () => {
    expect(conflictReasonKey('somethingNewFromServer')).toBe('users.entraSync.conflict.unknown');
  });
});

const entraUser = (over: Partial<EntraDirectoryUser> = {}): EntraDirectoryUser => ({
  id: 'aaaa1111-2222-3333-4444-555555555555',
  userPrincipalName: 'somchai@psd.co.th',
  displayName: 'สมชาย',
  mail: null,
  mobilePhone: null,
  accountEnabled: true,
  userType: 'Member',
  ...over,
});

describe('entraDirectoryRows', () => {
  it('server ไม่ส่งแถวมา = ได้รายการว่าง', () => {
    expect(entraDirectoryRows(result())).toEqual([]);
  });

  it('ผูกสถานะการจับคู่เข้ากับแต่ละแถว', () => {
    const rows = entraDirectoryRows(
      result({
        entraUsers: [
          entraUser({ userPrincipalName: 'somchai@psd.co.th' }),
          entraUser({ userPrincipalName: 'kept@psd.co.th' }),
          entraUser({ userPrincipalName: 'new@psd.co.th' }),
          entraUser({ userPrincipalName: 'linked@psd.co.th' }),
        ],
        updates: [
          update({ upn: 'somchai@psd.co.th' }),
          update({ upn: 'kept@psd.co.th', patch: {}, keptLocal: ['Email'] }),
        ],
        missingInSystem: [{ upn: 'new@psd.co.th', displayName: null, oid: 'o' }],
      }),
    );

    expect(rows.map((r) => r.status)).toEqual(['update', 'keptLocal', 'missing', 'linked']);
  });

  it('แถวที่รอผูก oid พาบัญชีปลายทางมาด้วย', () => {
    const rows = entraDirectoryRows(
      result({
        entraUsers: [
          entraUser({ id: 'oid-unlinked', userPrincipalName: 'somchai@psd.co.th' }),
          entraUser({ userPrincipalName: 'fillonly@psd.co.th' }),
        ],
        updates: [
          update({
            upn: 'somchai@psd.co.th',
            userId: '25',
            username: 'devmeen',
            patch: { AzureObjectId: 'oid-unlinked' },
          }),
          update({ upn: 'fillonly@psd.co.th', patch: { Email: 'fillonly@psd.co.th' } }),
        ],
      }),
    );

    expect(rows[0].linkTo).toEqual({ userId: '25', username: 'devmeen' });
    expect(rows[1].linkTo).toBeNull();
  });

  it('แถว conflict ไม่มีปลายทางให้ผูก และพาเหตุผลมาด้วย', () => {
    const rows = entraDirectoryRows(
      result({
        entraUsers: [entraUser({ userPrincipalName: 'somchai@psd.co.th' })],
        updates: [update({ upn: 'somchai@psd.co.th', patch: { AzureObjectId: 'oid-1' } })],
        conflicts: [
          {
            upn: 'somchai@psd.co.th',
            username: 'somchai',
            reason: 'boundToAnotherAzureAccount',
            detail: '',
          },
        ],
      }),
    );

    expect(rows[0].status).toBe('conflict');
    expect(rows[0].linkTo).toBeNull();
    expect(rows[0].conflictReason).toBe('boundToAnotherAzureAccount');
  });

  it('แถวที่ไม่ใช่ conflict ไม่มีเหตุผล', () => {
    const rows = entraDirectoryRows(result({ entraUsers: [entraUser()] }));
    expect(rows[0].conflictReason).toBeNull();
  });

  it('แถวที่ไม่ตรงกันพาชื่อช่องมาด้วย', () => {
    const rows = entraDirectoryRows(
      result({
        entraUsers: [
          entraUser({ userPrincipalName: 'kept@psd.co.th' }),
          entraUser({ userPrincipalName: 'clean@psd.co.th' }),
        ],
        updates: [update({ upn: 'kept@psd.co.th', patch: {}, keptLocal: ['Email', 'FirstName'] })],
      }),
    );

    expect(rows[0]).toMatchObject({ status: 'keptLocal', keptLocalFields: ['Email', 'FirstName'] });
    expect(rows[1].keptLocalFields).toEqual([]);
  });

  it('เทียบ UPN แบบไม่สนตัวพิมพ์', () => {
    const rows = entraDirectoryRows(
      result({
        entraUsers: [entraUser({ userPrincipalName: 'IT-Somchai@PSD.co.th' })],
        updates: [update({ upn: 'it-somchai@psd.co.th' })],
      }),
    );
    expect(rows[0].status).toBe('update');
  });

  it('conflict ชนะสถานะอื่น', () => {
    const rows = entraDirectoryRows(
      result({
        entraUsers: [entraUser({ userPrincipalName: 'taken@psd.co.th' })],
        missingInSystem: [{ upn: 'taken@psd.co.th', displayName: null, oid: 'o' }],
        conflicts: [
          {
            upn: 'taken@psd.co.th',
            username: 'taken',
            reason: 'boundToAnotherAzureAccount',
            detail: '',
          },
        ],
      }),
    );
    expect(rows[0].status).toBe('conflict');
  });

  it('ทุกสถานะมี i18n key และโทนของป้าย', () => {
    for (const status of ['update', 'keptLocal', 'linked', 'missing', 'conflict'] as const) {
      expect(rowStatusKey(status)).toBe(`users.entraSync.rowStatus.${status}`);
    }
    expect(rowStatusTone('linked')).toBe('success');
    expect(rowStatusTone('conflict')).toBe('destructive');
    expect(rowStatusTone('missing')).toBe('neutral');
  });
});

describe('filterDirectoryRows', () => {
  const rows = entraDirectoryRows(
    result({
      entraUsers: [
        entraUser({ userPrincipalName: 'somchai@psd.co.th', displayName: 'สมชาย' }),
        entraUser({
          userPrincipalName: 'somsri@psd.co.th',
          displayName: 'สมศรี',
          mail: 'somsri.contact@psd.co.th',
        }),
      ],
    }),
  );

  it('คำค้นว่าง = ได้ทุกแถว', () => {
    expect(filterDirectoryRows(rows, '   ')).toHaveLength(2);
  });

  it('ค้นได้ทั้ง UPN ชื่อ และอีเมล', () => {
    expect(filterDirectoryRows(rows, 'SOMSRI')).toHaveLength(1);
    expect(filterDirectoryRows(rows, 'สมชาย')[0].userPrincipalName).toBe('somchai@psd.co.th');
    expect(filterDirectoryRows(rows, 'contact')).toHaveLength(1);
  });

  it('ค้นฟิลด์เสริมที่ยังซ่อนอยู่ได้ด้วย', () => {
    const extra = entraDirectoryRows(
      result({
        entraUsers: [
          entraUser({ employeeId: 'EMP-777', jobTitle: 'ช่างติดตั้ง' }),
          entraUser({ userPrincipalName: 'other@psd.co.th' }),
        ],
      }),
    );

    expect(filterDirectoryRows(extra, 'emp-777')).toHaveLength(1);
    expect(filterDirectoryRows(extra, 'ช่างติดตั้ง')).toHaveLength(1);
  });

  it('accountEnabled ไม่เข้าการค้นหา', () => {
    expect(filterDirectoryRows(rows, 'true')).toEqual([]);
  });

  it('ไม่ตรงอะไรเลย = ว่าง (หน้าจอเอาไปโชว์ข้อความ ไม่ใช่ตารางเปล่า)', () => {
    expect(filterDirectoryRows(rows, 'ไม่มีคนนี้')).toEqual([]);
  });
});

describe('paginateDirectory', () => {
  const rows = entraDirectoryRows(
    result({
      entraUsers: Array.from({ length: 7 }, (_, index) =>
        entraUser({ id: `oid-${index}`, userPrincipalName: `user${index}@psd.co.th` }),
      ),
    }),
  );

  it('ตัดตามหน้าและบอกช่วงลำดับสำหรับข้อความสรุป', () => {
    const page2 = paginateDirectory(rows, 2, 3);

    expect(page2.rows.map((row) => row.userPrincipalName)).toEqual([
      'user3@psd.co.th',
      'user4@psd.co.th',
      'user5@psd.co.th',
    ]);
    expect(page2).toMatchObject({ page: 2, pageCount: 3, from: 4, to: 6, total: 7 });
  });

  it('หน้าสุดท้ายไม่เต็มก็ไม่เกินจำนวนจริง', () => {
    expect(paginateDirectory(rows, 3, 3)).toMatchObject({ from: 7, to: 7, pageCount: 3 });
  });

  it('เลขหน้าเกินขอบถูกดึงกลับเป็นหน้าสุดท้าย', () => {
    expect(paginateDirectory(rows, 99, 3)).toMatchObject({ page: 3, from: 7, to: 7 });
  });

  it('เลขหน้าต่ำกว่า 1 หรือค่าเพี้ยน = หน้า 1', () => {
    expect(paginateDirectory(rows, 0, 3).page).toBe(1);
    expect(paginateDirectory(rows, Number.NaN, 3).page).toBe(1);
  });

  it('ไม่มีแถวเลย = หน้า 1/1 และช่วงเป็น 0 (ไม่ใช่ 1–0)', () => {
    expect(paginateDirectory([], 1, 25)).toMatchObject({
      page: 1,
      pageCount: 1,
      from: 0,
      to: 0,
      total: 0,
    });
  });
});

describe('directoryColumns', () => {
  it('ค่าเริ่มต้นโชว์แต่ฟิลด์หลัก', () => {
    const core = directoryColumns(false).map((column) => column.field);

    expect(core).toEqual(['userPrincipalName', 'displayName', 'givenName', 'jobTitle']);
    expect(core.length).toBeLessThan(DIRECTORY_COLUMNS.length);
  });

  it('ไม่มีคอลัมน์แผนก / บริษัท / เบอร์โทร (ระบบนี้ไม่มีข้อมูลเหล่านี้)', () => {
    const all = directoryColumns(true).map((column) => column.field);

    for (const dropped of ['department', 'companyName', 'mobilePhone', 'businessPhones']) {
      expect(all).not.toContain(dropped);
    }
  });

  it('mail / oid / accountEnabled / userType ไม่ใช่คอลัมน์หลัก แต่ยังกางดูได้', () => {
    const core = directoryColumns(false).map((column) => column.field);
    const all = directoryColumns(true).map((column) => column.field);

    for (const field of ['mail', 'id', 'accountEnabled', 'userType', 'employeeId']) {
      expect(core).not.toContain(field);
      expect(all).toContain(field);
    }
  });

  it('เปิดทุกฟิลด์ = ได้ครบ และฟิลด์หลักยังมาก่อน', () => {
    const all = directoryColumns(true);

    expect(all).toHaveLength(DIRECTORY_COLUMNS.length);
    expect(all[0].field).toBe('userPrincipalName');
  });

  it('ทุกคอลัมน์มีชื่อหัวตารางผ่าน i18n', () => {
    for (const column of DIRECTORY_COLUMNS) {
      expect(column.labelKey).toBe(`users.entraSync.field.${column.field}`);
    }
  });
});

describe('scopeNotes', () => {
  it('บอกว่ากรองเหลือเฉพาะ Member ที่เปิดใช้งาน', () => {
    const keys = scopeNotes(result()).map((n) => n.key);
    expect(keys).toContain('users.entraSync.scope.activeMembersOnly');
  });

  it('เตือนเรื่องบัญชีที่ไม่ใช่คนเสมอ (filter ของ Graph แยกไม่ได้)', () => {
    const keys = scopeNotes(result({ filteredAtGraph: false })).map((n) => n.key);
    expect(keys).toEqual(['users.entraSync.scope.nonHumanWarning']);
  });

  it('จำกัดโดเมน = บอกโดเมนและจำนวนที่ตัดออก', () => {
    const notes = scopeNotes(
      result({ allowedDomains: ['psd.co.th', 'psdroadsolutions.com'], entraDroppedByDomain: 12 }),
    );
    const domain = notes.find((n) => n.key === 'users.entraSync.scope.domains');
    expect(domain?.values).toEqual({ domains: 'psd.co.th, psdroadsolutions.com', dropped: 12 });
  });

  it('กรองโดเมนที่ Graph = บอกฟิลด์ที่ใช้เทียบ ไม่บอกจำนวนที่ตัด', () => {
    const notes = scopeNotes(
      result({
        allowedDomains: ['psd.co.th'],
        entraDroppedByDomain: 0,
        domainFilteredAtGraph: true,
        domainField: 'mail',
      }),
    );

    expect(notes.map((n) => n.key)).not.toContain('users.entraSync.scope.domains');
    expect(notes.find((n) => n.key === 'users.entraSync.scope.domainsAtGraph')?.values).toEqual({
      domains: 'psd.co.th',
      field: 'mail',
    });
  });
});

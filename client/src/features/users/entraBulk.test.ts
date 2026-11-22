import { describe, expect, it } from 'vitest';

import {
  BULK_MAX,
  bulkCreatable,
  bulkPayload,
  bulkSkipKey,
  bulkSummary,
  canSubmitBulk,
  planBulkCreate,
} from './entraBulk';
import type { EntraDirectoryRow } from './entraSync';

const row = (patch: Partial<EntraDirectoryRow> = {}): EntraDirectoryRow => ({
  id: 'oid-1',
  userPrincipalName: 'somchai@psd.co.th',
  displayName: 'สมชาย ทดสอบ',
  mail: null,
  mobilePhone: null,
  accountEnabled: true,
  userType: 'Member',
  status: 'missing',
  keptLocalFields: [],
  linkTo: null,
  conflictReason: null,
  ...patch,
});

describe('planBulkCreate', () => {
  it('เติมค่าจาก Entra ให้ทุกแถว และไม่เดาบทบาท', () => {
    const [candidate] = planBulkCreate([row()]);

    expect(candidate.values.username).toBe('somchai');
    expect(candidate.values.fullName).toBe('สมชาย ทดสอบ');
    expect(candidate.values.email).toBe('somchai@psd.co.th');
    expect(candidate.values.azureObjectId).toBe('oid-1');
    expect(candidate.values.roleCode).toBe('');
    expect(candidate.skip).toBeUndefined();
  });

  it('ข้ามแถวที่มีบัญชีในระบบแล้ว', () => {
    const [candidate] = planBulkCreate([row({ status: 'linked' })]);

    expect(candidate.skip).toBe('notMissing');
  });

  it('ข้ามแถวที่ตั้งชื่อผู้ใช้จากข้อมูล Entra ไม่ได้', () => {
    const [candidate] = planBulkCreate([row({ userPrincipalName: 'ก@psd.co.th' })]);

    expect(candidate.skip).toBe('usernameEmpty');
  });

  it('ชื่อผู้ใช้ซ้ำกันในกลุ่ม = ข้ามตัวที่มาทีหลัง (ตัวแรกยังสร้าง)', () => {
    const plan = planBulkCreate([
      row({ id: 'oid-a', userPrincipalName: 'somchai@psd.co.th' }),
      row({ id: 'oid-b', userPrincipalName: 'somchai@psdroadsolutions.com' }),
    ]);

    expect(plan[0].skip).toBeUndefined();
    expect(plan[1].skip).toBe('duplicateUsername');
    expect(bulkCreatable(plan)).toHaveLength(1);
  });

  it('ทุกเหตุผลของการข้ามมีข้อความแปล', () => {
    for (const reason of ['notMissing', 'usernameEmpty', 'duplicateUsername'] as const) {
      expect(bulkSkipKey(reason)).toBe(`users.entraSync.bulk.skip.${reason}`);
    }
  });
});

describe('bulkPayload', () => {
  it('บทบาทมาจากกลุ่ม ส่วนที่เหลือมาจาก Entra และไม่มีรหัสผ่าน', () => {
    const [candidate] = planBulkCreate([row()]);
    const payload = bulkPayload(candidate, { roleCode: 'OPERATOR' });

    expect(payload).toEqual({
      username: 'somchai',
      fullName: 'สมชาย ทดสอบ',
      email: 'somchai@psd.co.th',
      roleCode: 'OPERATOR',
      azureObjectId: 'oid-1',
    });
    expect('password' in payload).toBe(false);
  });
});

describe('canSubmitBulk / bulkSummary', () => {
  it('ยังไม่เลือกบทบาท = กดยืนยันไม่ได้', () => {
    const plan = planBulkCreate([row()]);

    expect(canSubmitBulk(plan, { roleCode: '' })).toBe(false);
    expect(canSubmitBulk(plan, { roleCode: 'OPERATOR' })).toBe(true);
  });

  it('ไม่มีแถวที่สร้างได้ = กดยืนยันไม่ได้ (กดแล้วไม่เกิดอะไรดูเหมือนพัง)', () => {
    const plan = planBulkCreate([row({ status: 'linked' })]);

    expect(canSubmitBulk(plan, { roleCode: 'OPERATOR' })).toBe(false);
  });

  it('เกินเพดานต่อครั้ง = กดยืนยันไม่ได้', () => {
    const plan = planBulkCreate(
      Array.from({ length: BULK_MAX + 1 }, (_, index) =>
        row({ id: `oid-${index}`, userPrincipalName: `user${index}@psd.co.th` }),
      ),
    );

    expect(canSubmitBulk(plan, { roleCode: 'OPERATOR' })).toBe(false);
  });

  it('สรุปแยกสำเร็จ/ไม่สำเร็จ', () => {
    expect(
      bulkSummary([
        { oid: 'a', upn: 'a@psd.co.th', username: 'a', ok: true },
        { oid: 'b', upn: 'b@psd.co.th', username: 'b', ok: false, error: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' },
      ]),
    ).toEqual({ created: 1, failed: 1 });
  });

  it('เพดานต่อครั้งเท่ากับหนึ่งหน้าของตาราง', () => {
    expect(BULK_MAX).toBe(50);
  });
});

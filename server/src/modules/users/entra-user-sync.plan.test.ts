import { describe, expect, it } from 'vitest';
import {
  planEntraUserSync,
  planHasWrites,
  type EntraUser,
  type LocalUserRow,
} from './entra-user-sync.plan';

const entra = (over: Partial<EntraUser> = {}): EntraUser => ({
  id: '11111111-1111-1111-1111-111111111111',
  userPrincipalName: 'somchai@psd.co.th',
  displayName: 'สมชาย ใจดี',
  mail: 'somchai@psd.co.th',
  mobilePhone: '0812345678',
  accountEnabled: true,
  userType: 'Member',
  ...over,
});

const local = (over: Partial<LocalUserRow> = {}): LocalUserRow => ({
  Id: 1n,
  Username: 'somchai',
  Email: null,
  Phone: null,
  FirstName: null, LastName: null,
  AzureObjectId: null,
  ...over,
});

describe('planEntraUserSync — การจับคู่', () => {
  it('อีเมลตรง = ผูก oid + เติมช่องที่ว่างให้', () => {
    const plan = planEntraUserSync([entra()], [local({ Email: 'somchai@psd.co.th' })]);

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].patch).toEqual({
      AzureObjectId: '11111111-1111-1111-1111-111111111111',
      FirstName: 'สมชาย', LastName: 'ใจดี',
      Phone: '0812345678',
    });
    expect(plan.updates[0].patch.Email).toBeUndefined();
  });

  it('แถวที่ยังไม่มีทั้งอีเมลและ oid = จับคู่ไม่ได้ (ค่าเริ่มต้น)', () => {
    const plan = planEntraUserSync([entra()], [local()]);

    expect(plan.updates).toHaveLength(0);
    expect(plan.missingInSystem.map((m) => m.upn)).toEqual(['somchai@psd.co.th']);
    expect(plan.notInEntra.map((n) => n.username)).toEqual(['somchai']);
  });

  it('เปิด matchByUsername = จับด้วยส่วนหน้า @ แล้วเติมอีเมลให้ (ขั้นที่ปลดล็อก SSO)', () => {
    const plan = planEntraUserSync([entra()], [local()], { matchByUsername: true });

    expect(plan.updates[0].patch.Email).toBe('somchai@psd.co.th');
    expect(plan.updates[0].patch.AzureObjectId).toBeTruthy();
    expect(plan.missingInSystem).toHaveLength(0);
  });

  it('matchByUsername ไม่แตะแถวที่มีอีเมลอยู่แล้ว (กันเดาทับของจริง)', () => {
    const rows = [local({ Id: 1n, Username: 'somchai', Email: 'other.person@psd.co.th' })];
    const plan = planEntraUserSync([entra()], rows, { matchByUsername: true });

    expect(plan.updates).toHaveLength(0);
    expect(plan.missingInSystem).toHaveLength(1);
  });

  it('matchByUsername ตรงหลายแถว = ไม่เดา', () => {
    const rows = [
      local({ Id: 1n, Username: 'somchai' }),
      local({ Id: 2n, Username: 'somchai' }),
    ];
    const plan = planEntraUserSync([entra()], rows, { matchByUsername: true });

    expect(plan.updates).toHaveLength(0);
    expect(plan.missingInSystem).toHaveLength(1);
  });

  it('ค้นด้วย oid ก่อนอีเมล — เปลี่ยนนามสกุลแล้ว UPN เปลี่ยนก็ยังจับคู่ได้', () => {
    const rows = [
      local({ Email: 'somchai.old@psd.co.th', AzureObjectId: '11111111-1111-1111-1111-111111111111' }),
    ];
    const plan = planEntraUserSync([entra({ userPrincipalName: 'somchai.new@psd.co.th' })], rows);

    expect(plan.missingInSystem).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.updates[0].patch.Email).toBe('somchai.new@psd.co.th');
    expect(plan.updates[0].keptLocal).not.toContain('Email');
  });

  it('ตรงกันครบแล้ว = unchanged ไม่มีอะไรให้เขียน', () => {
    const plan = planEntraUserSync(
      [entra()],
      [
        local({
          Email: 'somchai@psd.co.th',
          Phone: '0812345678',
          FirstName: 'สมชาย', LastName: 'ใจดี',
          AzureObjectId: '11111111-1111-1111-1111-111111111111',
        }),
      ],
    );

    expect(plan.unchanged).toBe(1);
    expect(planHasWrites(plan)).toBe(false);
  });

  it('เทียบอีเมลแบบไม่แยกตัวพิมพ์ (ตรงกับ UQ_Users_Email ที่ใช้ lower())', () => {
    const plan = planEntraUserSync(
      [entra({ userPrincipalName: 'Somchai@PSD.co.th' })],
      [local({ Email: 'somchai@psd.co.th' })],
    );
    expect(plan.missingInSystem).toHaveLength(0);
    expect(plan.updates[0].patch.AzureObjectId).toBeTruthy();
  });
});

describe('planEntraUserSync — สิ่งที่ห้ามทำ', () => {
  it('ไม่สร้างบัญชีใหม่ — รายงานเป็น missingInSystem ให้ผู้ดูแลตัดสิน role เอง', () => {
    const plan = planEntraUserSync([entra()], []);

    expect(plan.updates).toHaveLength(0);
    expect(plan.missingInSystem).toEqual([
      {
        upn: 'somchai@psd.co.th',
        displayName: 'สมชาย ใจดี',
        oid: '11111111-1111-1111-1111-111111111111',
      },
    ]);
  });

  it('ไม่ลบ/ไม่ปิดบัญชีที่ไม่มีใน Entra — รายงานเป็น notInEntra', () => {
    const plan = planEntraUserSync([], [local({ Username: 'admin', Email: null })]);

    expect(plan.updates).toHaveLength(0);
    expect(plan.notInEntra).toEqual([{ username: 'admin', email: null }]);
  });

  it('updates existing profile names from Microsoft', () => {
    const plan = planEntraUserSync(
      [entra({ displayName: 'Somchai Jaidee' })],
      [local({ Email: 'somchai@psd.co.th', FirstName: 'สมชาย', LastName: '(หัวหน้าทีม)' })],
    );

    expect(plan.updates[0].patch).toMatchObject({ FirstName: 'Somchai', LastName: 'Jaidee' });
    expect(plan.updates[0].keptLocal).toEqual([]);
  });

  it('แถวผูก oid อื่นอยู่แล้ว = conflict ไม่ย้ายให้', () => {
    const plan = planEntraUserSync(
      [entra()],
      [local({ Email: 'somchai@psd.co.th', AzureObjectId: '99999999-9999-9999-9999-999999999999' })],
    );

    expect(plan.updates).toHaveLength(0);
    expect(plan.conflicts[0].reason).toBe('boundToAnotherAzureAccount');
    expect(plan.conflicts[0].username).toBe('somchai');
  });

  it('ไม่แตะ Status — accountEnabled=false ก็ไม่มีผลกับแผน', () => {
    const plan = planEntraUserSync(
      [entra({ accountEnabled: false })],
      [local({ Email: 'somchai@psd.co.th' })],
    );

    expect(JSON.stringify(plan.updates[0].patch)).not.toContain('Status');
  });
});

describe('planEntraUserSync — กรณีขอบ', () => {
  it('fills an empty phone from Microsoft and preserves a manually entered phone', () => {
    const empty = planEntraUserSync([entra()], [local({ Email: 'somchai@psd.co.th' })]);
    expect(empty.updates[0].patch.Phone).toBe('0812345678');
    const manual = planEntraUserSync([entra()], [local({ Email: 'somchai@psd.co.th', Phone: '029999999' })]);
    expect(manual.updates[0].patch).not.toHaveProperty('Phone');
  });
  it('takes profile changes from Microsoft for matched email accounts', () => {
    const plan = planEntraUserSync(
      [entra({ givenName: 'Somchai', surname: 'Jaidee' })],
      [local({ Email: 'somchai@psd.co.th', FirstName: 'Old', LastName: 'Name' })],
    );
    expect(plan.updates[0].patch).toMatchObject({ FirstName: 'Somchai', LastName: 'Jaidee' });
    expect(plan.updates[0].keptLocal).toEqual([]);
  });

  it('clears a removed Microsoft surname but keeps names when Microsoft supplies no name data', () => {
    const user = local({ Email: 'somchai@psd.co.th', FirstName: 'สมชาย', LastName: 'Old' });
    const cleared = planEntraUserSync([entra({ givenName: 'สมชาย', surname: null })], [user]);
    expect(cleared.updates[0].patch.LastName).toBe('');
    const missing = planEntraUserSync([entra({ displayName: null })], [user]);
    expect(missing.updates[0].patch).not.toHaveProperty('FirstName');
    expect(missing.updates[0].patch).not.toHaveProperty('LastName');
  });

  it('prefers structured Entra names and updates changed name parts', () => {
    const plan = planEntraUserSync(
      [entra({ givenName: 'Mary Jane', surname: 'Watson', displayName: 'Watson, Mary Jane' })],
      [local({ Email: 'somchai@psd.co.th', FirstName: 'Local', LastName: '' })],
    );
    expect(plan.updates[0].patch).toMatchObject({ FirstName: 'Mary Jane', LastName: 'Watson' });
    expect(plan.updates[0].keptLocal).toEqual([]);
  });

  it('UPN เดียวจับได้หลายแถว = conflict ไม่เดาว่าแถวไหน', () => {
    const plan = planEntraUserSync(
      [entra()],
      [
        local({ Id: 1n, Username: 'somchai', Email: 'somchai@psd.co.th' }),
        local({ Id: 2n, Username: 'somchai2', Email: 'Somchai@psd.co.th' }),
      ],
    );

    expect(plan.updates).toHaveLength(0);
    expect(plan.conflicts[0].reason).toBe('ambiguousLocalMatch');
  });

  it('Entra ส่ง UPN ซ้ำในรายการเดียว = conflict', () => {
    const plan = planEntraUserSync(
      [entra(), entra({ id: '22222222-2222-2222-2222-222222222222' })],
      [local({ Email: 'somchai@psd.co.th' })],
    );
    expect(plan.conflicts.some((c) => c.reason === 'duplicateUpnFromEntra')).toBe(true);
  });

  it('ไม่มี UPN (บัญชีห้องประชุม/ทรัพยากร) = ข้ามเงียบ ๆ ไม่นับเป็น conflict', () => {
    const plan = planEntraUserSync([entra({ userPrincipalName: '  ' })], []);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.missingInSystem).toHaveLength(0);
  });

  it('ค่ายาวเกินคอลัมน์ = ไม่เติม (ไม่งั้น update พังที่ DB)', () => {
    const plan = planEntraUserSync(
      [entra({ displayName: 'ก'.repeat(201) })],
      [local({ Email: 'somchai@psd.co.th' })],
    );

    expect(plan.updates[0].patch.FirstName).toBeUndefined();
    expect(plan.updates[0].patch.AzureObjectId).toBeTruthy();
  });

  it('ค่าว่าง/ช่องว่างล้วนจาก Entra = ไม่เติม', () => {
    const plan = planEntraUserSync(
      [entra({ displayName: '   ' })],
      [local({ Email: 'somchai@psd.co.th' })],
    );
    expect(plan.updates[0].patch.FirstName).toBeUndefined();
  });

  it('รันซ้ำหลังเขียนแล้ว = ไม่มีอะไรให้เขียนอีก (idempotent)', () => {
    const first = planEntraUserSync([entra()], [local()], { matchByUsername: true });
    const applied = local({
      Email: first.updates[0].patch.Email ?? null,
      Phone: first.updates[0].patch.Phone ?? null,
      FirstName: first.updates[0].patch.FirstName ?? null,
      LastName: first.updates[0].patch.LastName ?? null,
      AzureObjectId: first.updates[0].patch.AzureObjectId ?? null,
    });

    const second = planEntraUserSync([entra()], [applied]);
    expect(planHasWrites(second)).toBe(false);
    expect(second.unchanged).toBe(1);
  });
});

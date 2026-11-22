import { describe, expect, it } from 'vitest';
import {
  GRAPH_SELECT_FIELDS,
  keepAllowedDomains,
  parseGraphUser,
  readGraphConfig,
  usersFilter,
} from './graph-users.client';
import type { EntraUser } from './entra-user-sync.plan';

const user = (upn: string): EntraUser => ({
  id: 'x',
  userPrincipalName: upn,
  displayName: null,
  mail: null,
  mobilePhone: null,
  accountEnabled: true,
  userType: 'Member',
});

const BASE = {
  AZURE_AD_TENANT_ID: '11111111-2222-3333-4444-555555555555',
  GRAPH_CLIENT_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  GRAPH_CLIENT_SECRET: 'secret',
};

describe('usersFilter', () => {
  it('ค่าเริ่มต้น = เอาเฉพาะ Member ที่เปิดใช้งาน และไม่ต้องใช้ advanced query', () => {
    expect(usersFilter(false)).toEqual({
      filter: "accountEnabled eq true and userType eq 'Member'",
      advanced: false,
    });
  });

  it('GRAPH_INCLUDE_ALL = ไม่ส่ง $filter (ไว้ไล่ปัญหา)', () => {
    expect(usersFilter(true)).toEqual({ filter: null, advanced: false });
  });

  it('ตั้งโดเมน = กรองที่ Graph ด้วย endsWith และบังคับ advanced query', () => {
    expect(usersFilter(false, ['psd.co.th'])).toEqual({
      filter:
        "accountEnabled eq true and userType eq 'Member' and (endsWith(userPrincipalName,'@psd.co.th'))",
      advanced: true,
    });
  });

  it('หลายโดเมนต่อด้วย or และครอบวงเล็บ', () => {
    const { filter } = usersFilter(false, ['psd.co.th', 'psdroadsolutions.com']);

    expect(filter).toBe(
      "accountEnabled eq true and userType eq 'Member' and " +
        "(endsWith(userPrincipalName,'@psd.co.th') or endsWith(userPrincipalName,'@psdroadsolutions.com'))",
    );
  });

  it('GRAPH_DOMAIN_FIELD=mail = เทียบด้วย mail', () => {
    const { filter } = usersFilter(false, ['psd.co.th'], 'mail');

    expect(filter).toContain("endsWith(mail,'@psd.co.th')");
  });

  it('includeAll ชนะ แม้ตั้งโดเมนไว้', () => {
    expect(usersFilter(true, ['psd.co.th'])).toEqual({ filter: null, advanced: false });
  });

  it("escape เครื่องหมาย ' ในค่าโดเมน", () => {
    const { filter } = usersFilter(false, ["ev'il.com"]);

    expect(filter).toContain("endsWith(userPrincipalName,'@ev''il.com')");
  });
});

describe('keepAllowedDomains', () => {
  it('ไม่ตั้งโดเมน = ไม่กรอง', () => {
    const users = [user('a@psd.co.th'), user('b@other.com')];
    expect(keepAllowedDomains(users, [])).toHaveLength(2);
  });

  it('กรองตามโดเมน แบบไม่แยกตัวพิมพ์', () => {
    const users = [user('a@PSD.co.th'), user('b@psdroadsolutions.com'), user('c@outlook.com')];
    const kept = keepAllowedDomains(users, ['psd.co.th', 'psdroadsolutions.com']);
    expect(kept.map((u) => u.userPrincipalName)).toEqual(['a@PSD.co.th', 'b@psdroadsolutions.com']);
  });

  it('โดเมนที่ลงท้ายคล้ายกันต้องไม่หลุดเข้ามา', () => {
    const kept = keepAllowedDomains([user('x@notpsd.co.th')], ['psd.co.th']);
    expect(kept).toHaveLength(0);
  });

  it('UPN ไม่มี @ = ตัดออก', () => {
    expect(keepAllowedDomains([user('broken')], ['psd.co.th'])).toHaveLength(0);
  });
});

describe('parseGraphUser', () => {
  it('ไม่มี id หรือ UPN = ข้ามแถว (บัญชีห้องประชุม/ทรัพยากร)', () => {
    expect(parseGraphUser({ displayName: 'ห้องประชุม' })).toBeNull();
    expect(parseGraphUser({ id: 'x', userPrincipalName: '' })).toBeNull();
  });

  it('อ่านฟิลด์เสริมครบ และ businessPhones เป็น array', () => {
    const parsed = parseGraphUser({
      id: 'oid-1',
      userPrincipalName: 'somchai@psd.co.th',
      displayName: 'สมชาย',
      givenName: 'สมชาย',
      surname: 'ทดสอบ',
      businessPhones: ['02-111-2222', '', 'ต่อ 101'],
      jobTitle: 'ช่างติดตั้ง',
      department: 'INSTALL',
      companyName: 'PSD',
      officeLocation: 'สำนักงานใหญ่',
      employeeId: 'EMP-001',
      employeeType: 'Employee',
      onPremisesSamAccountName: 'somchai',
      createdDateTime: '2024-01-31T04:05:06Z',
    });

    expect(parsed?.businessPhones).toEqual(['02-111-2222', 'ต่อ 101']);
    expect(parsed?.employeeId).toBe('EMP-001');
    expect(parsed?.onPremisesSamAccountName).toBe('somchai');
    expect(parsed?.createdDateTime).toBe('2024-01-31T04:05:06Z');
  });

  it('ช่องว่างล้วน / ไม่ส่งมา / ชนิดผิด = null', () => {
    const parsed = parseGraphUser({
      id: 'oid-2',
      userPrincipalName: 'b@psd.co.th',
      jobTitle: '   ',
      employeeId: 12345,
      accountEnabled: 'true',
    });

    expect(parsed?.jobTitle).toBeNull();
    expect(parsed?.employeeId).toBeNull();
    expect(parsed?.department).toBeNull();
    expect(parsed?.businessPhones).toEqual([]);
    expect(parsed?.accountEnabled).toBeNull();
  });

  it('ทุกฟิลด์ใน $select มีที่เก็บใน EntraUser', () => {
    const parsed = parseGraphUser({ id: 'oid-3', userPrincipalName: 'c@psd.co.th' });
    for (const field of GRAPH_SELECT_FIELDS) {
      expect(parsed).toHaveProperty(field);
    }
  });
});

describe('readGraphConfig — โดเมนและโหมด', () => {
  it('ถอยไปใช้ AZURE_AD_ALLOWED_EMAIL_DOMAINS เมื่อไม่ตั้ง GRAPH_ALLOWED_DOMAINS', () => {
    const config = readGraphConfig({
      ...BASE,
      AZURE_AD_ALLOWED_EMAIL_DOMAINS: '@PSD.co.th, psdroadsolutions.com',
    });
    expect(config.allowedDomains).toEqual(['psd.co.th', 'psdroadsolutions.com']);
  });

  it('GRAPH_ALLOWED_DOMAINS ทับค่าของ SSO ได้เมื่อต้องการแยกกัน', () => {
    const config = readGraphConfig({
      ...BASE,
      AZURE_AD_ALLOWED_EMAIL_DOMAINS: 'psd.co.th',
      GRAPH_ALLOWED_DOMAINS: 'psdconstruction2011.com',
    });
    expect(config.allowedDomains).toEqual(['psdconstruction2011.com']);
  });

  it('ไม่ตั้งทั้งคู่ = ไม่จำกัดโดเมน และ includeAll ปิดอยู่', () => {
    const config = readGraphConfig(BASE);
    expect(config.allowedDomains).toEqual([]);
    expect(config.includeAll).toBe(false);
  });
});

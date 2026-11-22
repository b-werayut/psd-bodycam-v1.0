import { describe, expect, it } from 'vitest';

import { entraLinkView, upnByOid } from './entraLink';
import type { EntraSyncResult } from './users.api';

const OID_A = 'AAAA1111-2222-3333-4444-555555555555';
const OID_B = 'bbbb2222-2222-3333-4444-555555555555';

const directory = (): EntraSyncResult => ({
  dryRun: true,
  entraTotal: 2,
  entraFetched: 2,
  entraDroppedByDomain: 0,
  filteredAtGraph: true,
  allowedDomains: [],
  domainFilteredAtGraph: false,
  domainField: 'userPrincipalName',
  applied: 0,
  unchanged: 2,
  updates: [],
  missingInSystem: [],
  notInEntra: [],
  conflicts: [],
  entraFields: [],
  entraUsers: [
    {
      id: OID_A,
      userPrincipalName: 'Somsri.New@psd.co.th',
      displayName: 'สมศรี',
      mail: null,
      mobilePhone: null,
      accountEnabled: true,
      userType: 'Member',
    },
    {
      id: OID_B,
      userPrincipalName: 'somchai@psd.co.th',
      displayName: 'สมชาย',
      mail: null,
      mobilePhone: null,
      accountEnabled: true,
      userType: 'Member',
    },
  ],
});

describe('upnByOid', () => {
  it('คีย์เป็นตัวพิมพ์เล็ก (Entra ส่ง GUID ตัวพิมพ์ใหญ่ปนมาได้)', () => {
    const map = upnByOid(directory());

    expect(map.get(OID_A.toLowerCase())).toBe('Somsri.New@psd.co.th');
    expect(map.size).toBe(2);
  });

  it('ไม่มีแถวจาก Entra = แผนที่ว่าง ไม่พัง', () => {
    expect(upnByOid({ ...directory(), entraUsers: [] }).size).toBe(0);
  });
});

describe('entraLinkView', () => {
  const map = upnByOid(directory());

  it('ไม่มี oid = ยังไม่ผูก', () => {
    expect(entraLinkView({ email: 'a@psd.co.th', azureObjectId: null }, map)).toMatchObject({
      state: 'unlinked',
    });
  });

  it('ยังไม่ได้ดึงข้อมูล = notLoaded (ไม่ใช่ notFound)', () => {
    expect(entraLinkView({ email: 'a@psd.co.th', azureObjectId: OID_A }, null)).toMatchObject({
      state: 'notLoaded',
      upn: null,
    });
  });

  it('UPN ตรงกับอีเมลในระบบ (ไม่สนตัวพิมพ์) = match', () => {
    expect(
      entraLinkView({ email: 'somsri.new@PSD.co.th', azureObjectId: OID_A }, map),
    ).toMatchObject({ state: 'match', upn: 'Somsri.New@psd.co.th' });
  });

  it('UPN ไม่ตรงกับอีเมลในระบบ = mismatch พร้อมบอก UPN ปัจจุบัน', () => {
    expect(
      entraLinkView({ email: 'somsri.old@psd.co.th', azureObjectId: OID_A }, map),
    ).toMatchObject({ state: 'mismatch', upn: 'Somsri.New@psd.co.th' });
  });

  it('oid ที่ผูกไว้ไม่อยู่ในไดเรกทอรี = notFound', () => {
    expect(
      entraLinkView(
        { email: 'gone@psd.co.th', azureObjectId: '99999999-9999-4999-8999-999999999999' },
        map,
      ),
    ).toMatchObject({ state: 'notFound', upn: null });
  });

  it('อีเมลในระบบว่างแต่ผูก oid ไว้ = mismatch (ไม่ใช่ match กับค่าว่าง)', () => {
    expect(entraLinkView({ email: null, azureObjectId: OID_B }, map)).toMatchObject({
      state: 'mismatch',
      upn: 'somchai@psd.co.th',
    });
  });
});

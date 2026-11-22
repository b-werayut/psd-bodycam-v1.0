import { describe, expect, it } from 'vitest';
import {
  AzureAdConfigError,
  publicAzureAdConfig,
  readAzureAdConfig,
} from './azure-ad.config';

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('readAzureAdConfig', () => {
  it('ไม่ตั้งอะไรเลย = ปิด SSO (ไม่ throw) เพราะ dev ยังใช้รหัสผ่านได้', () => {
    const config = readAzureAdConfig({});
    expect(config.enabled).toBe(false);
  });

  it('ตั้งมาตัวเดียวต้อง throw — ตั้งใจจะเปิดแต่ทำไม่ครบ ห้ามเงียบ', () => {
    expect(() => readAzureAdConfig({ AZURE_AD_TENANT_ID: TENANT })).toThrow(
      AzureAdConfigError,
    );
    expect(() => readAzureAdConfig({ AZURE_AD_CLIENT_ID: CLIENT })).toThrow(
      AzureAdConfigError,
    );
  });

  it('GUID ผิดรูปแบบต้อง throw พร้อมบอกว่าคัดลอกค่ามาจากที่ไหน', () => {
    expect(() =>
      readAzureAdConfig({ AZURE_AD_TENANT_ID: 'psd.co.th', AZURE_AD_CLIENT_ID: CLIENT }),
    ).toThrow(/Directory \(tenant\) ID/);
    expect(() =>
      readAzureAdConfig({ AZURE_AD_TENANT_ID: TENANT, AZURE_AD_CLIENT_ID: 'not-a-guid' }),
    ).toThrow(/Application \(client\) ID/);
  });

  it('ประกอบ issuer/jwks เป็น v2.0 endpoint ของ tenant นั้น', () => {
    const config = readAzureAdConfig({
      AZURE_AD_TENANT_ID: TENANT,
      AZURE_AD_CLIENT_ID: CLIENT,
    });
    expect(config.enabled).toBe(true);
    expect(config.issuer).toBe(`https://login.microsoftonline.com/${TENANT}/v2.0`);
    expect(config.jwksUri).toBe(
      `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
    );
  });

  it('ตัด @ และช่องว่างออกจากรายการโดเมน แล้วทำเป็นตัวพิมพ์เล็ก', () => {
    const config = readAzureAdConfig({
      AZURE_AD_TENANT_ID: TENANT,
      AZURE_AD_CLIENT_ID: CLIENT,
      AZURE_AD_ALLOWED_EMAIL_DOMAINS: ' @PSD.co.th , psd-group.com ,, ',
    });
    expect(config.allowedEmailDomains).toEqual(['psd.co.th', 'psd-group.com']);
  });
});

describe('publicAzureAdConfig', () => {
  it('ปิดอยู่ = ไม่ส่ง id ใด ๆ ออกไป', () => {
    expect(publicAzureAdConfig(readAzureAdConfig({}))).toEqual({ enabled: false });
  });

  it('เปิดอยู่ = ส่ง clientId/tenantId/authority ให้ MSAL ตั้งค่าเอง', () => {
    const config = readAzureAdConfig({
      AZURE_AD_TENANT_ID: TENANT,
      AZURE_AD_CLIENT_ID: CLIENT,
    });
    expect(publicAzureAdConfig(config)).toEqual({
      enabled: true,
      clientId: CLIENT,
      tenantId: TENANT,
      authority: `https://login.microsoftonline.com/${TENANT}`,
    });
  });
});


const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AzureAdConfig = {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  issuer: string;
  jwksUri: string;
  allowedEmailDomains: string[];
};

export class AzureAdConfigError extends Error {}

const clean = (value: string | undefined): string => (value ?? '').trim();

export function readAzureAdConfig(env: NodeJS.ProcessEnv): AzureAdConfig {
  const tenantId = clean(env.AZURE_AD_TENANT_ID);
  const clientId = clean(env.AZURE_AD_CLIENT_ID);

  if (!tenantId && !clientId) {
    return {
      enabled: false,
      tenantId: '',
      clientId: '',
      issuer: '',
      jwksUri: '',
      allowedEmailDomains: [],
    };
  }

  if (!tenantId || !clientId) {
    throw new AzureAdConfigError(
      'ต้องตั้ง AZURE_AD_TENANT_ID และ AZURE_AD_CLIENT_ID ให้ครบทั้งคู่ (ตั้งมาตัวเดียวจะเปิด SSO ไม่ได้)',
    );
  }
  if (!GUID.test(tenantId)) {
    throw new AzureAdConfigError(
      `AZURE_AD_TENANT_ID '${tenantId}' ไม่ใช่ GUID — คัดลอกค่า Directory (tenant) ID จากหน้า App registration`,
    );
  }
  if (!GUID.test(clientId)) {
    throw new AzureAdConfigError(
      `AZURE_AD_CLIENT_ID '${clientId}' ไม่ใช่ GUID — คัดลอกค่า Application (client) ID จากหน้า App registration`,
    );
  }

  return {
    enabled: true,
    tenantId,
    clientId,
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
    allowedEmailDomains: clean(env.AZURE_AD_ALLOWED_EMAIL_DOMAINS)
      .split(',')
      .map((d) => d.trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean),
  };
}

export function publicAzureAdConfig(config: AzureAdConfig) {
  if (!config.enabled) return { enabled: false as const };
  return {
    enabled: true as const,
    clientId: config.clientId,
    tenantId: config.tenantId,
    authority: `https://login.microsoftonline.com/${config.tenantId}`,
  };
}

/** Nest token of the AzureAdConfig object (mutable on purpose: tests point jwksUri at a local JWKS). */
export const AZURE_AD_CONFIG = Symbol('AZURE_AD_CONFIG');

/** Boot rule: with SSO off and AUTH_PASSWORD_LOGIN_ENABLED=false nobody could sign in. */
export function assertSomeLoginMethod(config: Pick<AzureAdConfig, 'enabled'>, env: NodeJS.ProcessEnv): void {
  const passwordOn = (env.AUTH_PASSWORD_LOGIN_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
  if (!config.enabled && !passwordOn) {
    throw new AzureAdConfigError(
      'ไม่ได้ตั้ง AZURE_AD_* (SSO ปิด) และ AUTH_PASSWORD_LOGIN_ENABLED=false — จะไม่มีใครเข้าระบบได้เลย',
    );
  }
}

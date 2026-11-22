
export type AzureIdentity = {
  objectId: string;
  email: string;
  displayName: string | null;
};

export class AzureClaimsError extends Error {}

type Claims = Record<string, unknown>;

const str = (claims: Claims, key: string): string | null => {
  const value = claims[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

export function extractAzureIdentity(
  claims: Claims,
  options: { tenantId: string; allowedEmailDomains?: string[] },
): AzureIdentity {
  const objectId = str(claims, 'oid');
  if (!objectId) {
    throw new AzureClaimsError(
      'token ไม่มี claim `oid` — ที่ Azure Portal > Token configuration ต้องมี optional claim นี้',
    );
  }

  const tid = str(claims, 'tid');
  if (tid && tid.toLowerCase() !== options.tenantId.toLowerCase()) {
    throw new AzureClaimsError('บัญชีนี้อยู่คนละ tenant กับที่ระบบอนุญาต');
  }

  const rawEmail =
    str(claims, 'preferred_username') ?? str(claims, 'email') ?? str(claims, 'upn');
  if (!rawEmail || !rawEmail.includes('@')) {
    throw new AzureClaimsError(
      'token ไม่มีอีเมล/UPN ที่ใช้จับคู่บัญชีได้ — ตรวจ scope `openid profile email` ที่ฝั่งหน้าเว็บ',
    );
  }
  const email = rawEmail.toLowerCase();

  const domains = options.allowedEmailDomains ?? [];
  if (domains.length > 0) {
    const domain = email.slice(email.lastIndexOf('@') + 1);
    if (!domains.includes(domain)) {
      throw new AzureClaimsError(`อีเมลโดเมน '${domain}' ไม่อยู่ในรายการที่อนุญาต`);
    }
  }

  return { objectId, email, displayName: str(claims, 'name') };
}

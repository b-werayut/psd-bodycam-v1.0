import { SignJWT, jwtVerify } from 'jose';
import type { JwtPayload } from './auth-user';

const DEV_FALLBACK_SECRET = 'dev-insecure-jwt-secret-change-me';
const DEFAULT_TTL = '15m';

/** JWT_ACCESS_SECRET; dev may run without it, production may not. */
export function accessTokenSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = (env.JWT_ACCESS_SECRET ?? '').trim();
  if (secret) return secret;
  if (env.NODE_ENV === 'production') {
    throw new Error('ไม่ได้ตั้ง JWT_ACCESS_SECRET — production ต้องตั้งค่าสุ่มอย่างน้อย 32 ตัวอักษร');
  }
  return DEV_FALLBACK_SECRET;
}

const key = (env: NodeJS.ProcessEnv) => new TextEncoder().encode(accessTokenSecret(env));

/** HS256, lifetime ACCESS_TOKEN_TTL (default 15m). `now` is for tests. */
export function signAccessToken(
  payload: JwtPayload,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const { sub, ...claims } = payload;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiry(issuedAt, env.ACCESS_TOKEN_TTL))
    .sign(key(env));
}

/** The payload, or null for any invalid, tampered or expired token. */
export async function verifyAccessToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, key(env), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string') return null;
    // Tokens issued before the naming migration remain valid until their normal expiry.
    const roleCode = payload.roleCode === 'SUPERADMIN' ? 'SUPER_ADMIN'
      : payload.roleCode === 'TEAMLEADER' ? 'TEAM_LEADER' : payload.roleCode;
    return {
      sub: payload.sub,
      username: String(payload.username),
      roleId: String(payload.roleId),
      roleCode: roleCode as JwtPayload['roleCode'],
      permissions: Array.isArray(payload.permissions) ? (payload.permissions as JwtPayload['permissions']) : [],
    };
  } catch {
    return null;
  }
}

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** `15m`, `1h`, `30s`, `900` (seconds) ⇒ absolute exp; anything else ⇒ 15 minutes. */
function expiry(issuedAt: number, raw: string | undefined): number {
  const match = /^(\d+)\s*([smhd]?)$/.exec((raw ?? DEFAULT_TTL).trim());
  const seconds = match ? Number(match[1]) * UNIT_SECONDS[match[2] || 's'] : 15 * 60;
  return issuedAt + (seconds > 0 ? seconds : 15 * 60);
}

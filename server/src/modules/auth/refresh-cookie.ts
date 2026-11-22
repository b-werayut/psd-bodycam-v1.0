import type { CookieOptions } from 'express';
import { webRefreshTtlHours } from '../../common/config/refresh-ttl';

export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/auth';

const SAME_SITE = ['lax', 'none', 'strict'] as const;
type SameSite = (typeof SAME_SITE)[number];

export function refreshCookieOptions(env: NodeJS.ProcessEnv): CookieOptions {
  const raw = (env.COOKIE_SAMESITE ?? '').trim().toLowerCase();
  const sameSite: SameSite = (SAME_SITE as readonly string[]).includes(raw) ? (raw as SameSite) : 'lax';
  return {
    httpOnly: true,
    // Browsers drop SameSite=None cookies that are not Secure.
    secure: sameSite === 'none' ? true : env.COOKIE_SECURE === 'true',
    sameSite,
    path: REFRESH_COOKIE_PATH,
    maxAge: webRefreshTtlHours(env) * 3600 * 1000,
  };
}

/** The refresh token from a raw Cookie header (no cookie-parser needed for one cookie). */
export function readRefreshCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== REFRESH_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    if (!value) return undefined;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

import { describe, expect, it } from 'vitest';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH, readRefreshCookie, refreshCookieOptions } from './refresh-cookie';

describe('refreshCookieOptions', () => {
  it('dev defaults: httpOnly, lax, not secure, path /api/auth, 8 hours', () => {
    expect(REFRESH_COOKIE).toBe('refresh_token');
    expect(refreshCookieOptions({})).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: 8 * 3600 * 1000,
    });
    expect(REFRESH_COOKIE_PATH).toBe('/api/auth');
  });

  it('COOKIE_SECURE=true ⇒ secure', () => {
    expect(refreshCookieOptions({ COOKIE_SECURE: 'true' }).secure).toBe(true);
  });

  it('SameSite none forces Secure (browsers drop None without it)', () => {
    expect(refreshCookieOptions({ COOKIE_SAMESITE: 'None' })).toMatchObject({ sameSite: 'none', secure: true });
  });

  it('unknown SameSite falls back to lax', () => {
    expect(refreshCookieOptions({ COOKIE_SAMESITE: 'weird' }).sameSite).toBe('lax');
  });

  it('maxAge follows REFRESH_TOKEN_TTL_HOURS', () => {
    expect(refreshCookieOptions({ REFRESH_TOKEN_TTL_HOURS: '2' }).maxAge).toBe(2 * 3600 * 1000);
  });
});

describe('readRefreshCookie', () => {
  it('reads the token from the Cookie header among other cookies', () => {
    expect(readRefreshCookie('a=1; refresh_token=abc-DEF_123; b=2')).toBe('abc-DEF_123');
  });

  it('decodes URL-encoded values', () => {
    expect(readRefreshCookie('refresh_token=a%2Bb')).toBe('a+b');
  });

  it('missing header or cookie ⇒ undefined', () => {
    expect(readRefreshCookie(undefined)).toBeUndefined();
    expect(readRefreshCookie('other=1')).toBeUndefined();
    expect(readRefreshCookie('refresh_token=')).toBeUndefined();
  });

  it('does not match a cookie whose name only ends with refresh_token', () => {
    expect(readRefreshCookie('old_refresh_token=x')).toBeUndefined();
  });
});

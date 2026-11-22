import { describe, expect, it } from 'vitest';
import { rateLimitKey, rateLimitSpec, type RateLimitName } from './rate-limit-specs';

describe('rate limit specs (P0: auth only)', () => {
  it('defaults: login 60, sso 60, refresh 120 per minute, keyed by IP', () => {
    const expected: Record<RateLimitName, number> = { 'auth-login': 60, 'auth-sso': 60, 'auth-refresh': 120 };
    for (const [name, limit] of Object.entries(expected) as [RateLimitName, number][]) {
      expect(rateLimitSpec(name, {})).toEqual({ limit, windowSeconds: 60 });
    }
  });

  it('reads the per-minute limit from env', () => {
    expect(rateLimitSpec('auth-login', { AUTH_LOGIN_RATE_LIMIT_PER_MIN: '2' }).limit).toBe(2);
    expect(rateLimitSpec('auth-sso', { AUTH_SSO_RATE_LIMIT_PER_MIN: '7' }).limit).toBe(7);
    expect(rateLimitSpec('auth-refresh', { AUTH_REFRESH_RATE_LIMIT_PER_MIN: '9' }).limit).toBe(9);
  });

  it('ignores zero, negative, fractional and garbage env values', () => {
    for (const raw of ['0', '-5', '1.5', 'abc', '']) {
      expect(rateLimitSpec('auth-login', { AUTH_LOGIN_RATE_LIMIT_PER_MIN: raw }).limit).toBe(60);
    }
  });

  it('keys by name + IP, with a stable placeholder when the IP is unknown', () => {
    expect(rateLimitKey('auth-login', '203.0.113.5')).toBe('auth-login:ip:203.0.113.5');
    expect(rateLimitKey('auth-refresh', undefined)).toBe('auth-refresh:ip:unknown');
  });
});

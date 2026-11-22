import { describe, expect, it } from 'vitest';
import { REFRESH_REUSE_GRACE_SECONDS, refreshTokenState } from './refresh-reuse';

const t0 = new Date('2026-11-20T00:00:00Z');
const after = (ms: number) => new Date(t0.getTime() + ms);

describe('refreshTokenState', () => {
  it('not revoked ⇒ live', () => {
    expect(refreshTokenState({ RevokedAt: null, ReplacedByTokenId: null, ReplacedAt: null }, t0)).toBe('live');
  });

  it('replaced within the grace window ⇒ race (another tab rotated it first)', () => {
    expect(REFRESH_REUSE_GRACE_SECONDS).toBe(10);
    expect(refreshTokenState({ RevokedAt: t0, ReplacedByTokenId: 5n, ReplacedAt: t0 }, after(5_000))).toBe('race');
  });

  it('replaced longer ago than the grace window ⇒ reuse (stolen token)', () => {
    expect(refreshTokenState({ RevokedAt: t0, ReplacedByTokenId: 5n, ReplacedAt: t0 }, after(11_000))).toBe('reuse');
  });

  it('revoked without a replacement (logout, password change) ⇒ ended', () => {
    expect(refreshTokenState({ RevokedAt: t0, ReplacedByTokenId: null, ReplacedAt: null }, t0)).toBe('ended');
  });
});

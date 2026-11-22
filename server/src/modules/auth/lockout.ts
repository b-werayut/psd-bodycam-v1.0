// Password lockout (like the reference, with one change: a lock that has ended starts the count again,
// so a user gets the full number of attempts after waiting it out).

/** Users.Status. 3 stays reserved (the reference's LOCKED); a lock is LockedUntil only. */
export const USER_STATUS = { ACTIVE: 1, INACTIVE: 2 } as const;

export type LockoutPolicy = { maxFailed: number; lockMinutes: number };

export type LoginGate =
  | { ok: true }
  | { ok: false; reason: 'disabled' }
  | { ok: false; reason: 'temporary'; retryAfterMinutes: number };

export function checkLoginGate(state: { status: number; lockedUntil: Date | null }, now: Date): LoginGate {
  if (state.status !== USER_STATUS.ACTIVE) return { ok: false, reason: 'disabled' };
  const remainingMs = state.lockedUntil ? state.lockedUntil.getTime() - now.getTime() : 0;
  if (remainingMs > 0) {
    return { ok: false, reason: 'temporary', retryAfterMinutes: Math.max(1, Math.ceil(remainingMs / 60_000)) };
  }
  return { ok: true };
}

export function decideFailure(
  state: { failedCount: number; lockedUntil: Date | null },
  policy: LockoutPolicy,
  now: Date,
): { failedCount: number; lockedUntil: Date | null } {
  const lockEnded = state.lockedUntil !== null && state.lockedUntil.getTime() <= now.getTime();
  const failedCount = (lockEnded ? 0 : state.failedCount) + 1;
  if (failedCount < policy.maxFailed) return { failedCount, lockedUntil: null };
  return { failedCount, lockedUntil: new Date(now.getTime() + policy.lockMinutes * 60_000) };
}

export function lockedMessage(retryAfterMinutes: number): string {
  return `บัญชีถูกล็อกชั่วคราวเพราะกรอกรหัสผ่านผิดหลายครั้ง กรุณาลองใหม่ในอีก ${retryAfterMinutes} นาที`;
}

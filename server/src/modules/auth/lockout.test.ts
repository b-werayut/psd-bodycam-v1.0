import { describe, expect, it } from 'vitest';
import { USER_STATUS, checkLoginGate, decideFailure } from './lockout';

const now = new Date('2026-11-22T10:00:00Z');
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);

describe('checkLoginGate', () => {
  it('active and not locked ⇒ ok', () => {
    expect(checkLoginGate({ status: USER_STATUS.ACTIVE, lockedUntil: null }, now)).toEqual({ ok: true });
  });

  it('lock still running ⇒ temporary with minutes rounded up (at least 1)', () => {
    expect(checkLoginGate({ status: USER_STATUS.ACTIVE, lockedUntil: minutes(14.2) }, now)).toEqual({
      ok: false,
      reason: 'temporary',
      retryAfterMinutes: 15,
    });
    expect(
      checkLoginGate({ status: USER_STATUS.ACTIVE, lockedUntil: new Date(now.getTime() + 5_000) }, now),
    ).toMatchObject({ retryAfterMinutes: 1 });
  });

  it('lock that already ended ⇒ ok', () => {
    expect(checkLoginGate({ status: USER_STATUS.ACTIVE, lockedUntil: minutes(-1) }, now)).toEqual({ ok: true });
  });

  it('inactive account ⇒ disabled, even with no lock', () => {
    expect(checkLoginGate({ status: USER_STATUS.INACTIVE, lockedUntil: null }, now)).toEqual({
      ok: false,
      reason: 'disabled',
    });
  });
});

describe('decideFailure (max 3, 15 minutes)', () => {
  const policy = { maxFailed: 3, lockMinutes: 15 };

  it('1st and 2nd wrong password only count', () => {
    expect(decideFailure({ failedCount: 0, lockedUntil: null }, policy, now)).toEqual({
      failedCount: 1,
      lockedUntil: null,
    });
    expect(decideFailure({ failedCount: 1, lockedUntil: null }, policy, now)).toEqual({
      failedCount: 2,
      lockedUntil: null,
    });
  });

  it('3rd wrong password locks for 15 minutes', () => {
    expect(decideFailure({ failedCount: 2, lockedUntil: null }, policy, now)).toEqual({
      failedCount: 3,
      lockedUntil: minutes(15),
    });
  });

  it('after a lock has ended the count starts again from 1', () => {
    expect(decideFailure({ failedCount: 3, lockedUntil: minutes(-1) }, policy, now)).toEqual({
      failedCount: 1,
      lockedUntil: null,
    });
  });

  it('uses the policy values (e.g. 5 attempts, 30 minutes)', () => {
    const p = { maxFailed: 5, lockMinutes: 30 };
    expect(decideFailure({ failedCount: 3, lockedUntil: null }, p, now).lockedUntil).toBeNull();
    expect(decideFailure({ failedCount: 4, lockedUntil: null }, p, now).lockedUntil).toEqual(minutes(30));
  });
});

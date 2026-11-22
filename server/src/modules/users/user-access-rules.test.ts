import { describe, expect, it } from 'vitest';
import { USER_STATUS } from '../auth/lockout';
import { planUserAccessChange, userAccessBlockerOf } from './user-access-rules';

describe('userAccessBlockerOf', () => {
  it('cannot suspend your own account', () => {
    expect(userAccessBlockerOf(7n, 7n, false)).toBe('self');
  });

  it('can suspend someone else', () => {
    expect(userAccessBlockerOf(7n, 8n, false)).toBeNull();
  });

  it('restoring yourself is a harmless no-op', () => {
    expect(userAccessBlockerOf(7n, 7n, true)).toBeNull();
  });
});

describe('planUserAccessChange', () => {
  it('active ⇒ suspend: write the status and cut sessions', () => {
    expect(planUserAccessChange(USER_STATUS.ACTIVE, false)).toEqual({
      changed: true,
      status: USER_STATUS.INACTIVE,
      cutSessions: true,
    });
  });

  it('suspended ⇒ restore: write the status, no cut', () => {
    expect(planUserAccessChange(USER_STATUS.INACTIVE, true)).toEqual({
      changed: true,
      status: USER_STATUS.ACTIVE,
      cutSessions: false,
    });
  });

  it('suspending again still cuts sessions (repairs a cut that did not finish)', () => {
    expect(planUserAccessChange(USER_STATUS.INACTIVE, false)).toEqual({
      changed: false,
      status: USER_STATUS.INACTIVE,
      cutSessions: true,
    });
  });

  it('restoring an active account changes nothing', () => {
    expect(planUserAccessChange(USER_STATUS.ACTIVE, true)).toEqual({
      changed: false,
      status: USER_STATUS.ACTIVE,
      cutSessions: false,
    });
  });
});

import { USER_STATUS } from '../auth/lockout';

export type UserAccessBlocker = 'self' | null;

/** You cannot suspend yourself (you would be thrown out at once, maybe as the last users:manage holder). */
export function userAccessBlockerOf(targetId: bigint, actorId: bigint, enabled: boolean): UserAccessBlocker {
  return !enabled && targetId === actorId ? 'self' : null;
}

export type UserAccessPlan = { changed: boolean; status: number; cutSessions: boolean };

/**
 * Suspending again still cuts sessions (cutSessions follows `enabled`, not `changed`): it repairs a
 * previous suspension whose cut did not finish (realtime down, a token issued meanwhile).
 */
export function planUserAccessChange(current: number, enabled: boolean): UserAccessPlan {
  const status = enabled ? USER_STATUS.ACTIVE : USER_STATUS.INACTIVE;
  return { changed: current !== status, status, cutSessions: !enabled };
}

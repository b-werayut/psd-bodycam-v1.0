/**
 * Tells open sockets of a user that their session was cut (suspend, delete, password reset) so the
 * client signs out at once. Bound to RealtimeGateway.revokeUserSessions in UsersModule.
 */
export const SESSION_REVOCATION_NOTIFIER = Symbol('SESSION_REVOCATION_NOTIFIER');

export type SessionRevocation = { scope: 'account'; reason: string };

export interface SessionRevocationNotifier {
  notify(userId: bigint, payload: SessionRevocation): void;
}

export const REVOKE_REASON = {
  SUSPENDED: 'ผู้ดูแลระงับการเข้าระบบของบัญชีนี้',
  PASSWORD_RESET: 'ผู้ดูแลตั้งรหัสผ่านใหม่ให้บัญชีนี้',
  DELETED: 'บัญชีนี้ถูกลบ',
} as const;

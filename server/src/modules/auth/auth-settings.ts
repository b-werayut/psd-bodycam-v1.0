import type { LockoutPolicy } from './lockout';

/** Where AuthService reads the lockout policy from (bound to SettingsService — editable by SUPER_ADMIN). */
export const AUTH_SETTINGS = Symbol('AUTH_SETTINGS');

export interface AuthSettings {
  getLockoutPolicy(): Promise<LockoutPolicy>;
}

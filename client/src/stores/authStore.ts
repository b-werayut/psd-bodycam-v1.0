import { create } from 'zustand';
import type { TranslationKey } from '@/i18n/locales/th';

export type AuthNotice = { key: TranslationKey; params?: Record<string, string> };

/** Web roles plus TEAM_LEADER (mobile only; it has no web menu but the API can still return it). */
export type RoleCode = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'TEAM_LEADER';

export type AuthUser = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
  roleCode: RoleCode;
  roleName: string;
  permissions: string[];
};

type AuthState = {
  accessToken: string | null;
  user: AuthUser | null;
  epoch: number;
  notice: AuthNotice | null;
  setAuth: (accessToken: string, user: AuthUser) => void;
  /** Pass a notice when the system ends the session; it survives clear() and shows on the login page. */
  clear: (notice?: AuthNotice) => void;
  setNotice: (notice: AuthNotice) => void;
  consumeNotice: () => AuthNotice | null;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  epoch: 0,
  notice: null,
  setAuth: (accessToken, user) =>
    set((state) => ({ accessToken, user, epoch: state.epoch + 1 })),
  clear: (notice) =>
    set((state) => ({
      accessToken: null,
      user: null,
      notice: notice ?? null,
      epoch: state.epoch + 1,
    })),
  setNotice: (notice) => set({ notice }),
  consumeNotice: () => {
    const notice = get().notice;
    if (notice) set({ notice: null });
    return notice;
  },
}));

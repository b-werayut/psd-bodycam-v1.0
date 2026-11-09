import { api } from '@/lib/apiClient';
import type { AuthUser } from '@/stores/authStore';

export type LoginResp = { accessToken: string; user: AuthUser };

export type AuthConfig = {
  sso:
    | { enabled: false }
    | { enabled: true; clientId: string; tenantId: string; authority: string };
  passwordLogin: { enabled: boolean };
};

export const authApi = {
  config: () => api.get<AuthConfig>('/auth/config').then((r) => r.data),
  login: (username: string, password: string) =>
    api.post<LoginResp>('/auth/login', { username, password }).then((r) => r.data),
  loginWithAzure: (idToken: string) =>
    api.post<LoginResp>('/auth/azure', { idToken }).then((r) => r.data),
  me: () => api.get<AuthUser>('/auth/me').then((r) => r.data),
  logout: (accessToken?: string | null) =>
    api
      .post('/auth/logout', null, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      })
      .then((r) => r.data),
};

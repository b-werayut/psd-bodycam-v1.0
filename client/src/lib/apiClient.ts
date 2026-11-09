import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/authStore';
import { isAuthEndpoint } from './authEndpoints';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export const API_BASE = BASE;

export const api = axios.create({ baseURL: BASE, withCredentials: true });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Wait before the single retry after `REFRESH_RACE`. Another tab or request rotated the same
 * cookie at the same moment. The session is still alive and the cookie jar now holds the
 * winner's token. A plain `setTimeout`, so fake timers drive it in tests.
 */
export const REFRESH_RACE_RETRY_MS = 750;

/**
 * - `ok`: new access token stored.
 * - `unauthenticated`: 401, the session is dead. Auth is cleared, with a notice only if a
 *   session existed.
 * - `unreachable`: network error, 5xx or another non-401. Auth is left untouched.
 * - `stale`: the session changed (login, logout, another refresh) while this one ran, so the
 *   result was discarded.
 */
export type RefreshOutcome =
  | { kind: 'ok'; token: string }
  | { kind: 'unauthenticated' }
  | { kind: 'unreachable' }
  | { kind: 'stale' };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function refreshErrorCode(error: unknown): string | undefined {
  if (!(error instanceof AxiosError)) return undefined;
  const code = (error.response?.data as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

async function doRefresh(): Promise<RefreshOutcome> {
  // Capture both at the start. `epoch` discards results after the session changed. `hadSession`
  // decides whether a dead refresh is "your session expired" or just a first visit.
  const { epoch, accessToken } = useAuthStore.getState();
  const hadSession = accessToken !== null;
  const stale = () => useAuthStore.getState().epoch !== epoch;

  for (let attempt = 1; ; attempt += 1) {
    try {
      const r = await axios.post(`${BASE}/auth/refresh`, null, { withCredentials: true });
      if (stale()) return { kind: 'stale' };
      useAuthStore.getState().setAuth(r.data.accessToken, r.data.user);
      return { kind: 'ok', token: r.data.accessToken as string };
    } catch (error) {
      if (stale()) return { kind: 'stale' };
      const status = error instanceof AxiosError ? error.response?.status : undefined;
      if (status !== 401) return { kind: 'unreachable' };
      if (refreshErrorCode(error) === 'REFRESH_RACE' && attempt === 1) {
        await wait(REFRESH_RACE_RETRY_MS);
        if (stale()) return { kind: 'stale' };
        continue;
      }
      // No session means nothing to clear. Clearing anyway would wipe a notice already
      // waiting for the login page, such as `auth.sessionRevoked`.
      if (hadSession) useAuthStore.getState().clear({ key: 'auth.sessionExpired' });
      return { kind: 'unauthenticated' };
    }
  }
}

let refreshing: Promise<RefreshOutcome> | null = null;

/** Single-flight: concurrent callers share one `/auth/refresh` until it settles. */
export function refreshSession(): Promise<RefreshOutcome> {
  if (!refreshing) {
    const current: Promise<RefreshOutcome> = doRefresh().finally(() => {
      // Clear only our own slot. After `resetRefreshState()` a newer refresh may own it.
      if (refreshing === current) refreshing = null;
    });
    refreshing = current;
  }
  return refreshing;
}

export function refreshToken(): Promise<string | null> {
  return refreshSession().then((outcome) => (outcome.kind === 'ok' ? outcome.token : null));
}

/**
 * Resolves once any in-flight refresh has settled, however it ended. Logout awaits this so it
 * revokes the cookie the refresh rotated to, not the one the refresh used up.
 */
export function waitForPendingRefresh(): Promise<void> {
  return refreshing ? refreshing.then(() => undefined) : Promise.resolve();
}

export function resetRefreshState(): void {
  refreshing = null;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    if (
      error.response?.status === 401 &&
      original &&
      !original._retried &&
      !isAuthEndpoint(original.url)
    ) {
      original._retried = true;
      const token = await refreshToken();
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deferred } from '@/test/deferred';
import { useAuthStore, type AuthUser } from '@/stores/authStore';
import {
  REFRESH_RACE_RETRY_MS,
  api,
  refreshSession,
  refreshToken,
  resetRefreshState,
  waitForPendingRefresh,
} from './apiClient';

const USER: AuthUser = {
  id: '1',
  username: 'u',
  fullName: 'U',
  email: null,
  roleCode: 'VIEWER',
  roleName: 'Viewer',
  departmentId: null,
  departmentName: null,
  permissions: [],
};

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown = {}) {
  const response = { data, status, statusText: '', headers: {}, config };
  if (status >= 200 && status < 300) return Promise.resolve(response);
  return Promise.reject(new AxiosError('fail', 'ERR', config, null, response));
}
const networkError = (config: InternalAxiosRequestConfig) =>
  Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config));
const okResponse = (data: unknown) => ({
  data,
  status: 200,
  statusText: '',
  headers: {},
  config: {} as InternalAxiosRequestConfig,
});

let refreshCalls = 0;
let refreshHandler: (config: InternalAxiosRequestConfig) => Promise<unknown>;

const adapter: AxiosAdapter = (config) => {
  const url = config.url ?? '';
  if (url.includes('/auth/refresh')) {
    refreshCalls += 1;
    return refreshHandler(config) as ReturnType<AxiosAdapter>;
  }
  if (config.headers.Authorization === 'Bearer new') return respond(config, 200);
  return respond(config, 401);
};

const origApi = api.defaults.adapter;
const origAxios = axios.defaults.adapter;

describe('api client', () => {
  beforeEach(() => {
    api.defaults.adapter = adapter;
    axios.defaults.adapter = adapter;
    refreshCalls = 0;
    resetRefreshState();
    refreshHandler = (c) => respond(c, 200, { accessToken: 'new', user: USER });
    useAuthStore.setState({ accessToken: null, user: null, notice: null });
    useAuthStore.getState().setAuth('old', USER);
  });
  afterEach(() => {
    api.defaults.adapter = origApi;
    axios.defaults.adapter = origAxios;
    resetRefreshState();
    vi.useRealTimers();
  });

  it('refreshes once for three concurrent 401s and retries all', async () => {
    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(refreshCalls).toBe(1);
    expect(useAuthStore.getState().accessToken).toBe('new');
  });

  it('clears the session with a notice when refresh fails', async () => {
    refreshHandler = (c) => respond(c, 401);
    await expect(api.get('/a')).rejects.toBeTruthy();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().notice).toEqual({ key: 'auth.sessionExpired' });
    expect(refreshCalls).toBe(1);
  });

  it('ignores a refresh result when the session changed meanwhile (epoch)', async () => {
    const pending = deferred<unknown>();
    refreshHandler = () => pending.promise;
    const inflight = refreshToken();
    useAuthStore.getState().setAuth('other', { ...USER, id: '2' });
    pending.resolve(okResponse({ accessToken: 'stale', user: USER }));
    await expect(inflight).resolves.toBeNull();
    expect(useAuthStore.getState().accessToken).toBe('other');
    expect(useAuthStore.getState().user?.id).toBe('2');
  });

  it('does not clear a new session when a stale refresh fails', async () => {
    const pending = deferred<unknown>();
    refreshHandler = () => pending.promise;
    const inflight = refreshToken();
    useAuthStore.getState().setAuth('other', { ...USER, id: '2' });
    pending.reject(new Error('401'));
    await expect(inflight).resolves.toBeNull();
    expect(useAuthStore.getState().accessToken).toBe('other');
  });

  it('does not revive a session after logout during refresh', async () => {
    const pending = deferred<unknown>();
    refreshHandler = () => pending.promise;
    const inflight = refreshToken();
    useAuthStore.getState().clear();
    pending.resolve(okResponse({ accessToken: 'stale', user: USER }));
    await expect(inflight).resolves.toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  describe('REFRESH_RACE (another tab rotated the same cookie)', () => {
    const race = (c: InternalAxiosRequestConfig) =>
      respond(c, 401, { statusCode: 401, code: 'REFRESH_RACE', message: 'race' });

    it('waits, retries once and stays signed in', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let call = 0;
      refreshHandler = (c) =>
        (call += 1) === 1 ? race(c) : respond(c, 200, { accessToken: 'new', user: USER });

      const outcome = refreshSession();
      await vi.advanceTimersByTimeAsync(REFRESH_RACE_RETRY_MS - 1);
      expect(refreshCalls).toBe(1);
      await vi.advanceTimersByTimeAsync(1);

      await expect(outcome).resolves.toEqual({ kind: 'ok', token: 'new' });
      expect(refreshCalls).toBe(2);
      expect(useAuthStore.getState().accessToken).toBe('new');
      expect(useAuthStore.getState().notice).toBeNull();
    });

    it('a second REFRESH_RACE ends the session', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      refreshHandler = race;

      const outcome = refreshSession();
      await vi.advanceTimersByTimeAsync(REFRESH_RACE_RETRY_MS);

      await expect(outcome).resolves.toEqual({ kind: 'unauthenticated' });
      expect(refreshCalls).toBe(2);
      expect(useAuthStore.getState().accessToken).toBeNull();
      expect(useAuthStore.getState().notice).toEqual({ key: 'auth.sessionExpired' });
    });

    it('waits in the 500–1000 ms band', () => {
      expect(REFRESH_RACE_RETRY_MS).toBeGreaterThanOrEqual(500);
      expect(REFRESH_RACE_RETRY_MS).toBeLessThanOrEqual(1000);
    });
  });

  it('a network error during refresh keeps the session (unreachable)', async () => {
    refreshHandler = networkError;
    await expect(refreshSession()).resolves.toEqual({ kind: 'unreachable' });
    expect(useAuthStore.getState().accessToken).toBe('old');
    expect(useAuthStore.getState().user).toEqual(USER);
    expect(useAuthStore.getState().notice).toBeNull();
  });

  it('a 5xx during refresh keeps the session and rejects the original 401', async () => {
    refreshHandler = (c) => respond(c, 503, { statusCode: 503, message: 'down' });
    await expect(api.get('/a')).rejects.toMatchObject({ response: { status: 401 } });
    expect(useAuthStore.getState().accessToken).toBe('old');
    expect(useAuthStore.getState().notice).toBeNull();
  });

  it('refreshToken keeps its string | null contract', async () => {
    await expect(refreshToken()).resolves.toBe('new');
    resetRefreshState();
    refreshHandler = networkError;
    await expect(refreshToken()).resolves.toBeNull();
  });

  it('no token (first visit): a 401 refresh adds no sessionExpired notice', async () => {
    useAuthStore.setState({ accessToken: null, user: null, notice: null });
    refreshHandler = (c) => respond(c, 401, { statusCode: 401, code: 'REFRESH_INVALID' });

    await expect(refreshSession()).resolves.toEqual({ kind: 'unauthenticated' });
    expect(useAuthStore.getState().notice).toBeNull();
  });

  it('keeps a notice already waiting for the login page when there was no session', async () => {
    useAuthStore.getState().clear({ key: 'auth.sessionRevoked' });
    refreshHandler = (c) => respond(c, 401, { statusCode: 401, code: 'REFRESH_INVALID' });

    await refreshSession();
    expect(useAuthStore.getState().notice).toEqual({ key: 'auth.sessionRevoked' });
  });

  it('a settled refresh from before resetRefreshState does not drop the new in-flight one', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const pending = [first, second];
    refreshHandler = () => pending.shift()!.promise;

    const old = refreshSession();
    resetRefreshState();
    const current = refreshSession();
    expect(refreshCalls).toBe(2);

    first.resolve(okResponse({ accessToken: 'a', user: USER }));
    await old;

    expect(refreshSession()).toBe(current);
    expect(refreshCalls).toBe(2);
    second.resolve(okResponse({ accessToken: 'b', user: USER }));
    await current;
  });

  describe('waitForPendingRefresh', () => {
    it('resolves at once when no refresh is running', async () => {
      await expect(waitForPendingRefresh()).resolves.toBeUndefined();
      expect(refreshCalls).toBe(0);
    });

    it('resolves only after the in-flight refresh settles, even if it fails', async () => {
      const pending = deferred<unknown>();
      refreshHandler = () => pending.promise;
      void refreshSession();

      let settled = false;
      const waiting = waitForPendingRefresh().then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      pending.reject(new AxiosError('Network Error', 'ERR_NETWORK'));
      await waiting;
      expect(settled).toBe(true);
    });
  });

  it('a 401 from POST /auth/login does not trigger a refresh or clear the session', async () => {
    await expect(api.post('/auth/login', { username: 'u', password: 'bad' })).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(refreshCalls).toBe(0);
    expect(useAuthStore.getState().accessToken).toBe('old');
    expect(useAuthStore.getState().notice).toBeNull();
  });
});

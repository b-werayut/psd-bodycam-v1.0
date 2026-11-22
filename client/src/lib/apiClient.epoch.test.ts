import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deferred } from '@/test/deferred';
import { useAuthStore, type AuthUser } from '@/stores/authStore';
import { api, resetRefreshState } from './apiClient';

const USER: AuthUser = {
  id: '1',
  username: 'u',
  fullName: 'U',
  email: null,
  roleCode: 'VIEWER',
  roleName: 'Viewer',
  permissions: [],
};

const reject401 = (config: InternalAxiosRequestConfig) =>
  Promise.reject(
    new AxiosError('401', 'ERR', config, null, {
      data: { code: 'UNAUTHORIZED' },
      status: 401,
      statusText: '',
      headers: {},
      config,
    }),
  );

let refreshCalls = 0;
const origApi = api.defaults.adapter;
const origAxios = axios.defaults.adapter;

describe('api client: requests from an older session (epoch)', () => {
  beforeEach(() => {
    refreshCalls = 0;
    resetRefreshState();
    useAuthStore.setState({ accessToken: null, user: null, notice: null });
    useAuthStore.getState().setAuth('old', USER);
  });
  afterEach(() => {
    api.defaults.adapter = origApi;
    axios.defaults.adapter = origAxios;
    resetRefreshState();
  });

  it('times out requests after 15 s', () => {
    expect(api.defaults.timeout).toBe(15_000);
  });

  it('a 401 for a request sent before logout does not refresh (no silent sign-in again)', async () => {
    const pending = deferred<unknown>();
    const refreshAdapter: AxiosAdapter = (config) => {
      if ((config.url ?? '').includes('/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve({ data: { accessToken: 'revived', user: USER }, status: 200, statusText: '', headers: {}, config });
      }
      return pending.promise.then(() => reject401(config)) as ReturnType<AxiosAdapter>;
    };
    api.defaults.adapter = refreshAdapter;
    axios.defaults.adapter = refreshAdapter;

    const request = api.get('/slow');
    useAuthStore.getState().clear();
    pending.resolve(undefined);

    await expect(request).rejects.toBeTruthy();
    expect(refreshCalls).toBe(0);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('a 401 for a request sent before another refresh finished retries with the new token, no second refresh', async () => {
    const pending = deferred<unknown>();
    const adapter: AxiosAdapter = (config) => {
      if ((config.url ?? '').includes('/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve({ data: { accessToken: 'x', user: USER }, status: 200, statusText: '', headers: {}, config });
      }
      if (config.headers.Authorization === 'Bearer rotated') {
        return Promise.resolve({ data: { ok: true }, status: 200, statusText: '', headers: {}, config });
      }
      return pending.promise.then(() => reject401(config)) as ReturnType<AxiosAdapter>;
    };
    api.defaults.adapter = adapter;
    axios.defaults.adapter = adapter;

    const request = api.get('/slow');
    useAuthStore.getState().setAuth('rotated', USER);
    pending.resolve(undefined);

    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(refreshCalls).toBe(0);
  });
});

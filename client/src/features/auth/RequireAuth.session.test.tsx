import { act, render, screen } from '@testing-library/react';
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LanguageProvider } from '@/i18n/LanguageProvider';
import { th } from '@/i18n/locales/th';
import { api, resetRefreshState } from '@/lib/apiClient';
import { useAuthStore, type AuthUser } from '@/stores/authStore';
import { RequireAuth } from './RequireAuth';

// Real apiClient + RequireAuth: what the login page will see after the boot / mid-session refresh.

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

function reject(config: InternalAxiosRequestConfig, status: number, data: unknown) {
  const response = { data, status, statusText: '', headers: {}, config };
  return Promise.reject(new AxiosError('fail', 'ERR', config, null, response));
}

let refreshAnswer: (config: InternalAxiosRequestConfig) => ReturnType<AxiosAdapter>;
const adapter: AxiosAdapter = (config) =>
  (config.url ?? '').includes('/auth/refresh')
    ? refreshAnswer(config)
    : reject(config, 401, { statusCode: 401, code: 'UNAUTHORIZED', message: 'x' });

const origApi = api.defaults.adapter;
const origAxios = axios.defaults.adapter;

function LoginProbe() {
  const notice = useAuthStore((s) => s.notice);
  return <p>{`login|notice:${notice?.key ?? 'none'}`}</p>;
}

function renderApp() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/users']}>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <p>protected content</p>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('RequireAuth + apiClient session notices', () => {
  beforeEach(() => {
    api.defaults.adapter = adapter;
    axios.defaults.adapter = adapter;
    resetRefreshState();
    useAuthStore.setState({ accessToken: null, user: null, notice: null });
    refreshAnswer = (c) =>
      reject(c, 401, { statusCode: 401, code: 'REFRESH_INVALID', message: 'หมดอายุ' });
  });
  afterEach(() => {
    api.defaults.adapter = origApi;
    axios.defaults.adapter = origAxios;
    resetRefreshState();
    useAuthStore.setState({ accessToken: null, user: null, notice: null });
  });

  it('first visit (no token): boot refresh 401 lands on /login with no sessionExpired notice', async () => {
    renderApp();
    expect(await screen.findByText('login|notice:none')).toBeInTheDocument();
  });

  it('signed in: a 401 refresh mid-session lands on /login with the sessionExpired notice', async () => {
    useAuthStore.getState().setAuth('old', USER);
    renderApp();
    expect(screen.getByText('protected content')).toBeInTheDocument();

    await act(async () => {
      await api.get('/users').catch(() => undefined);
    });

    expect(await screen.findByText('login|notice:auth.sessionExpired')).toBeInTheDocument();
  });

  it('server unreachable at boot: shows retry instead of /login', async () => {
    refreshAnswer = (c) => Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', c));
    renderApp();
    expect(await screen.findByText(th['auth.bootUnreachable.title'])).toBeInTheDocument();
    expect(screen.queryByText(/^login\|/)).toBeNull();
  });
});

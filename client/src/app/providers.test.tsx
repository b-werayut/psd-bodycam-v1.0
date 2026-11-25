import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppLayout } from '@/components/AppLayout';
import { LoginPage } from '@/features/auth/LoginPage';
import { useAuthStore } from '@/stores/authStore';
import { AppProviders } from './providers';

vi.mock('@/lib/socket', () => ({
  connectRealtime: vi.fn(() => ({ connected: false, active: true, on: vi.fn(), off: vi.fn(), disconnect: vi.fn(), connect: vi.fn() })),
  REALTIME_UNAUTHORIZED: 'unauthorized',
}));
vi.mock('@/features/auth/auth.api', () => ({
  authApi: {
    config: vi.fn(() => Promise.resolve({ sso: { enabled: false }, passwordLogin: { enabled: true } })),
    login: vi.fn(),
    loginWithAzure: vi.fn(),
    me: vi.fn(),
    logout: vi.fn(),
  },
}));

const toasters = () => document.querySelectorAll('section[aria-label^="Notifications"]').length;

afterEach(() => useAuthStore.setState({ accessToken: null, user: null, notice: null }));

describe('AppProviders', () => {
  it('mounts exactly one Toaster around the signed-in shell', () => {
    useAuthStore.setState({
      accessToken: 't',
      user: { id: '1', username: 'u', firstName: 'U', lastName: '', email: null, roleCode: 'SUPER_ADMIN', roleName: 'ผู้ดูแลระบบ', permissions: [] },
    });
    render(
      <AppProviders>
        <MemoryRouter>
          <Routes>
            <Route path="/" element={<AppLayout />} />
          </Routes>
        </MemoryRouter>
      </AppProviders>,
    );
    expect(toasters()).toBe(1);
  });

  it('mounts exactly one Toaster on the login page', () => {
    render(
      <AppProviders>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </MemoryRouter>
      </AppProviders>,
    );
    expect(toasters()).toBe(1);
  });
});

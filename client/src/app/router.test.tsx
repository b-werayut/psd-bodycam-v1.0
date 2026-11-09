import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/i18n/LanguageProvider';
import type { TranslationKey } from '@/i18n/locales/th';
import { translate } from '@/i18n/translate';
import { refreshSession } from '@/lib/apiClient';
import { useAuthStore, type AuthUser } from '@/stores/authStore';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { appRoutes } from './router';

vi.mock('@/lib/apiClient', () => ({ refreshSession: vi.fn() }));
vi.mock('@/features/auth/auth.api', () => ({
  authApi: {
    config: vi.fn(() => new Promise(() => {})),
    login: vi.fn(),
    loginWithAzure: vi.fn(),
  },
}));

// The settings page body is never reached by the access tests below (RequirePermission denies
// first). Only the ADMIN error-boundary test renders it, and that test needs it to throw.
vi.mock('@/features/settings/SettingsPage', () => ({
  SettingsPage: () => {
    throw new Error('render failed');
  },
}));

function signIn(permissions: string[], roleCode: AuthUser['roleCode'] = 'OPERATOR') {
  useAuthStore.setState({
    accessToken: 'token',
    user: {
      id: 'u1',
      username: 'op',
      fullName: 'สมชาย ใจดี',
      email: null,
      roleCode,
      roleName: roleCode,
      departmentId: null,
      departmentName: null,
      permissions,
    },
  });
}

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return render(
    <LanguageProvider>
      <ThemeProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>
    </LanguageProvider>,
  );
}

const t = (key: TranslationKey) => translate('th', key);

describe('router', () => {
  beforeEach(() => {
    vi.mocked(refreshSession).mockResolvedValue({ kind: 'unauthenticated' });
  });
  afterEach(() => {
    useAuthStore.setState({ accessToken: null, user: null });
  });

  it('renders the 404 page for an unknown authenticated path', async () => {
    signIn(['dashboard:view']);
    renderAt('/nope');
    expect(await screen.findByText(t('common.notFound.title'))).toBeInTheDocument();
  });

  it('redirects unauthenticated users to the login page', async () => {
    renderAt('/users');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Body Worn Camera');
  });

  it('shows the welcome header on home with dashboard:view', async () => {
    signIn(['dashboard:view']);
    renderAt('/');
    expect(await screen.findByRole('heading', { name: t('app.home.title') })).toBeInTheDocument();
    // the app shell header also shows the full name, so scope to the page content
    expect(within(screen.getByRole('main')).getByText('สมชาย ใจดี')).toBeInTheDocument();
  });

  it('home falls back to the first visible routed item without dashboard:view', async () => {
    signIn(['org:read']);
    renderAt('/');
    expect(
      await screen.findByRole('heading', { name: t('navigation.employees') }),
    ).toBeInTheDocument();
  });

  it('guards routes with the access map', async () => {
    signIn(['dashboard:view']);
    renderAt('/settings');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('a page that throws shows the route error inside the shell with a single main landmark', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    signIn([], 'ADMIN');
    renderAt('/settings');

    const title = await screen.findByText(t('common.routeError.title'));
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main')).toContainElement(title);
    consoleError.mockRestore();
  });

  it('allows a guarded route with permission', async () => {
    signIn(['users:read']);
    renderAt('/users');
    expect(await screen.findByRole('heading', { name: t('navigation.users') })).toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppLayout } from '@/components/AppLayout';
import { act } from '@testing-library/react';
import { actionToast } from '@/components/ui/action-toast';
import { Toaster } from '@/components/ui/sonner';
import { resetRefreshState, waitForPendingRefresh } from '@/lib/apiClient';
import { deferred } from '@/test/deferred';
import { resetQueryCache } from '@/lib/queryClient';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { authApi } from '@/features/auth/auth.api';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { th } from '@/i18n/locales/th';
import { useAuthStore, type AuthUser } from '@/stores/authStore';
import { ThemeProvider } from '@/theme/ThemeProvider';

vi.mock('@/features/auth/auth.api', () => ({ authApi: { logout: vi.fn() } }));
const fakeSocket = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const socket = {
    connected: false,
    on(event: string, fn: (...args: unknown[]) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(fn);
      listeners.set(event, set);
      return socket;
    },
    off(event: string, fn: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(fn);
      return socket;
    },
    disconnect() {
      return socket;
    },
    connect() {
      return socket;
    },
  };
  return {
    socket,
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    emit: (event: string, ...args: unknown[]) => {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
  };
});
vi.mock('@/lib/socket', () => ({
  connectRealtime: () => fakeSocket.socket,
  REALTIME_UNAUTHORIZED: 'unauthorized',
}));
vi.mock('@/lib/apiClient', () => ({
  refreshToken: vi.fn(() => Promise.resolve(null)),
  refreshSession: vi.fn(() => Promise.resolve({ kind: 'unauthenticated' })),
  resetRefreshState: vi.fn(),
  waitForPendingRefresh: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/queryClient', () => ({ resetQueryCache: vi.fn() }));

const t = (key: keyof typeof th) => th[key] as string;

const operator: AuthUser = {
  id: 'u1',
  username: 'operator',
  fullName: 'สมชาย ใจดี',
  email: 'somchai@example.com',
  roleCode: 'OPERATOR',
  roleName: 'ผู้ปฏิบัติงาน',
  permissions: ['dashboard:view', 'org:read', 'tracking:view', 'work-orders:read'],
};

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="current route">{location.pathname}</output>;
}

function AppLayoutHarness({ initialEntry = '/' }: { initialEntry?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <ThemeProvider>
          <MemoryRouter initialEntries={[initialEntry]}>
            <LocationProbe />
            <Routes>
              <Route
                path="/"
                element={
                  <RequireAuth>
                    <AppLayout />
                  </RequireAuth>
                }
              >
                <Route
                  index
                  element={
                    <>
                      <p>Dashboard content</p>
                      <Link to="/employees">go employees</Link>
                    </>
                  }
                />
                <Route path="employees" element={<p>Employees content</p>} />
              </Route>
              <Route path="/login" element={<p>Login destination</p>} />
            </Routes>
          </MemoryRouter>
          <Toaster />
        </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

async function openUserMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: /เมนูผู้ใช้ operator/ }), {
    key: 'Enter',
  });
  return screen.findByRole('menuitem', { name: t('header.logout') });
}

describe('AppLayout', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authApi.logout).mockResolvedValue(undefined);
    vi.mocked(waitForPendingRefresh).mockResolvedValue(undefined);
    useAuthStore.setState({ accessToken: 'token', user: operator, notice: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ accessToken: null, user: null, notice: null });
  });

  // jsdom does not evaluate Tailwind `lg:` classes, so "narrow viewport" is asserted on what the
  // markup decides: the desktop sidebar carries the base `hidden` class (shown only via `lg:flex`)
  // and the header menu button (`lg:hidden`) opens the drawer Dialog that hosts the mobile nav.
  it('uses a drawer on narrow viewports', async () => {
    const user = userEvent.setup();
    render(<AppLayoutHarness />);

    const desktopNav = screen.getByRole('navigation', { name: t('navigation.label') });
    const desktopAside = desktopNav.closest('aside');
    expect(desktopAside).toHaveAttribute('data-variant', 'desktop');
    expect(desktopAside).toHaveClass('hidden', 'lg:flex');

    const openMenu = screen.getByRole('button', { name: t('header.openMenu') });
    expect(openMenu).toHaveClass('lg:hidden');
    await user.click(openMenu);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeVisible();
    const drawerNav = within(dialog).getByRole('navigation', { name: t('navigation.label') });
    expect(drawerNav.closest('aside')).toHaveAttribute('data-variant', 'drawer');
  });

  it('closes the drawer after navigating from it', async () => {
    const user = userEvent.setup();
    render(<AppLayoutHarness />);
    await user.click(screen.getByRole('button', { name: t('header.openMenu') }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('link', { name: t('navigation.employees') }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('current route')).toHaveTextContent('/employees');
  });

  it('renders disabled nav items without links', () => {
    render(<AppLayoutHarness />);
    const nav = screen.getByRole('navigation', { name: t('navigation.label') });
    // ใบงาน has no page until P3
    const disabled = within(nav).getByText(t('navigation.workOrders')).closest('[aria-disabled]');

    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    expect(disabled).not.toHaveAttribute('href');
    expect(within(nav).getByRole('link', { name: t('navigation.employees') })).toHaveAttribute(
      'href',
      '/employees',
    );
  });

  it('shows the visible items under their menu groups and drops empty groups', () => {
    render(<AppLayoutHarness />);
    const nav = screen.getByRole('navigation', { name: t('navigation.label') });
    expect(within(nav).getAllByRole('button').map((head) => head.textContent)).toEqual([
      t('navigation.group.overview'),
      t('navigation.group.operations'),
      t('navigation.group.people'),
    ]);
  });

  it('shows ADMIN all 12 menu items in four groups', () => {
    useAuthStore.setState({ user: { ...operator, roleCode: 'ADMIN', permissions: [] } });
    render(<AppLayoutHarness />);
    const nav = screen.getByRole('navigation', { name: t('navigation.label') });
    expect(within(nav).getAllByRole('button').map((head) => head.textContent)).toEqual([
      t('navigation.group.overview'),
      t('navigation.group.operations'),
      t('navigation.group.people'),
      t('navigation.group.system'),
    ]);
    expect(within(nav).getAllByRole('link')).toHaveLength(12);
  });

  it('hides nav items the user has no permission for', () => {
    render(<AppLayoutHarness />);
    const nav = screen.getByRole('navigation', { name: t('navigation.label') });
    expect(within(nav).queryByText(t('navigation.users'))).toBeNull();
    expect(within(nav).queryByText(t('navigation.settings'))).toBeNull();
  });

  it('shows the login notice as an error toast and consumes it once', async () => {
    useAuthStore.setState({
      notice: { key: 'auth.destinationBlocked', params: { path: '/settings' } },
    });
    render(<AppLayoutHarness />);

    const toasts = await screen.findAllByText(/ไม่มีสิทธิ์เข้าหน้า \/settings/);
    expect(toasts.length).toBeGreaterThan(0);
    expect(useAuthStore.getState().notice).toBeNull();
  });

  it('shows only full name and role in the user menu and has no notification bell', async () => {
    render(<AppLayoutHarness />);
    await openUserMenu();

    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('สมชาย ใจดี')).toBeInTheDocument();
    expect(within(menu).getByText('ผู้ปฏิบัติงาน')).toBeInTheDocument();
    // the identity label holds one line per fact: name and role, nothing else
    const identity = within(menu).getByText('สมชาย ใจดี').parentElement?.parentElement;
    expect(identity?.children).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /การแจ้งเตือน/ })).toBeNull();
  });

  it('logout signs out locally at once and tells the server in the background', async () => {
    const server = deferred<undefined>();
    vi.mocked(authApi.logout).mockReturnValue(server.promise);
    render(<AppLayoutHarness />);
    fireEvent.click(await openUserMenu());

    // no waiting for the server: the store is empty and the login page is shown right away
    await waitFor(() => expect(screen.getByText('Login destination')).toBeInTheDocument());
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().notice).toBeNull();
    expect(resetRefreshState).toHaveBeenCalledTimes(1);
    expect(resetQueryCache).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(authApi.logout).toHaveBeenCalledWith('token'));
    server.resolve(undefined);
  });

  it('logout with a refresh in flight posts only after that refresh settles (so the rotated cookie is revoked)', async () => {
    const refresh = deferred<void>();
    vi.mocked(waitForPendingRefresh).mockReturnValue(refresh.promise);
    render(<AppLayoutHarness />);
    fireEvent.click(await openUserMenu());

    await waitFor(() => expect(screen.getByText('Login destination')).toBeInTheDocument());
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(authApi.logout).not.toHaveBeenCalled();

    await act(async () => {
      refresh.resolve();
    });
    await waitFor(() => expect(authApi.logout).toHaveBeenCalledTimes(1));
  });

  it('logout POST failure: still signed out, with an error toast', async () => {
    vi.mocked(authApi.logout).mockRejectedValue(new Error('server down'));
    const toastError = vi.spyOn(actionToast, 'error');
    render(<AppLayoutHarness />);
    fireEvent.click(await openUserMenu());

    await waitFor(() => expect(screen.getByText('Login destination')).toBeInTheDocument());
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        t('header.logoutFailedTitle'),
        t('auth.logoutServerFailed'),
      ),
    );
  });

  it('logout after the session already ended posts nothing and keeps the sessionExpired notice', async () => {
    render(<AppLayoutHarness />);
    const item = await openUserMenu();
    act(() => {
      useAuthStore.setState({ accessToken: null, notice: { key: 'auth.sessionExpired' } });
    });
    fireEvent.click(item);

    await waitFor(() => expect(screen.getByText('Login destination')).toBeInTheDocument());
    expect(authApi.logout).not.toHaveBeenCalled();
    expect(useAuthStore.getState().notice).toEqual({ key: 'auth.sessionExpired' });
  });

  it('on session:revoked (account) clears auth and goes to /login with notice', async () => {
    render(<AppLayoutHarness />);
    await waitFor(() => expect(fakeSocket.listenerCount('session:revoked')).toBe(1));

    act(() => fakeSocket.emit('session:revoked', { scope: 'account', reason: 'suspended', at: 'x' }));

    await waitFor(() => expect(screen.getByText('Login destination')).toBeInTheDocument());
    expect(screen.getByLabelText('current route')).toHaveTextContent('/login');
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().notice?.key).toBe('auth.sessionRevoked');
    expect(resetRefreshState).toHaveBeenCalled();
    expect(resetQueryCache).toHaveBeenCalled();
  });

  it('header clock shows Asia/Bangkok time and date whatever the machine zone', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T17:30:05.000Z'));
    try {
      render(<AppLayoutHarness />);
      const clock = screen.getByRole('timer');
      expect(clock).toHaveTextContent('00:30');
      expect(clock).toHaveTextContent('5 พ.ย.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders main content with a skip link', () => {
    render(<AppLayoutHarness />);
    expect(screen.getByRole('main')).toHaveTextContent('Dashboard content');
    expect(screen.getByRole('link', { name: t('app.skipToMain') })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(screen.getByRole('main')).not.toHaveClass('p-0');
  });
});

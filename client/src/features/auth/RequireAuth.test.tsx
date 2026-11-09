import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/i18n/LanguageProvider';
import { th } from '@/i18n/locales/th';
import { refreshSession } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import { RequireAuth } from './RequireAuth';

vi.mock('@/lib/apiClient', () => ({ refreshSession: vi.fn() }));

function LoginProbe() {
  const loc = useLocation();
  return <p>{`at:${loc.pathname}${loc.hash}|${JSON.stringify(loc.state)}`}</p>;
}

function renderAt(entry: string) {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={[entry]}>
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

describe('RequireAuth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAuthStore.setState({ accessToken: null, user: null });
    vi.mocked(refreshSession).mockResolvedValue({ kind: 'unauthenticated' });
  });

  afterEach(() => {
    useAuthStore.setState({ accessToken: null, user: null });
  });

  it('tries to restore the session, then redirects to /login remembering where from', async () => {
    renderAt('/users?x=1');

    expect(await screen.findByText(/^at:\/login/)).toHaveTextContent('{"from":"/users?x=1"}');
    expect(refreshSession).toHaveBeenCalled();
  });

  it('does not refresh while the URL carries the Azure redirect response, and forwards it to /login', async () => {
    renderAt('/#code=abc123&state=%2Ftracking');

    expect(await screen.findByText(/^at:\/login#code=abc123/)).toHaveTextContent('{"from":"/"}');
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('renders content when the refresh succeeds', async () => {
    vi.mocked(refreshSession).mockImplementation(async () => {
      useAuthStore.setState({ accessToken: 'new' });
      return { kind: 'ok', token: 'new' };
    });
    renderAt('/');

    expect(await screen.findByText('protected content')).toBeInTheDocument();
  });

  it('shows a status while booting', () => {
    vi.mocked(refreshSession).mockReturnValue(new Promise(() => {}));
    renderAt('/');

    expect(screen.getByRole('status', { name: 'กำลังตรวจสอบการเข้าสู่ระบบ' })).toBeInTheDocument();
  });

  it('renders content without refreshing when a token exists', async () => {
    useAuthStore.setState({ accessToken: 'token' });
    renderAt('/');

    expect(await screen.findByText('protected content')).toBeInTheDocument();
    await waitFor(() => expect(refreshSession).not.toHaveBeenCalled());
  });

  it('server unreachable: shows a retry Alert instead of redirecting to /login', async () => {
    vi.mocked(refreshSession).mockResolvedValueOnce({ kind: 'unreachable' });
    renderAt('/users');

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(th['auth.bootUnreachable.title'])).toBeInTheDocument();
    expect(within(alert).getByText(th['auth.bootUnreachable.description'])).toBeInTheDocument();
    expect(screen.queryByText(/^at:\/login/)).toBeNull();
    expect(screen.queryByText('protected content')).toBeNull();
  });

  it('server unreachable: Retry refreshes again and restores the session', async () => {
    vi.mocked(refreshSession)
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockImplementationOnce(async () => {
        useAuthStore.setState({ accessToken: 'new' });
        return { kind: 'ok', token: 'new' };
      });
    renderAt('/users');

    await userEvent.click(await screen.findByRole('button', { name: th['common.retry'] }));

    expect(await screen.findByText('protected content')).toBeInTheDocument();
    expect(refreshSession).toHaveBeenCalledTimes(2);
  });

  it('server unreachable: Retry that finds no session goes to /login', async () => {
    vi.mocked(refreshSession)
      .mockResolvedValueOnce({ kind: 'unreachable' })
      .mockResolvedValueOnce({ kind: 'unauthenticated' });
    renderAt('/users');

    await userEvent.click(await screen.findByRole('button', { name: th['common.retry'] }));

    expect(await screen.findByText(/^at:\/login/)).toHaveTextContent('{"from":"/users"}');
  });
});

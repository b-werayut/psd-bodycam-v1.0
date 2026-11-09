import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LanguageProvider } from '@/i18n/LanguageProvider';
import { th } from '@/i18n/locales/th';
import { useAuthStore, type AuthUser } from '@/stores/authStore';
import { RequirePermission } from './RequirePermission';

type Access = { anyOf: readonly string[]; allOf?: readonly string[] };
const MIXED: Access = { anyOf: ['org:read', 'settings:manage'], allOf: ['dashboard:view'] };

function renderGuard(
  permissions: string[],
  roleCode: AuthUser['roleCode'] = 'VIEWER',
  access: Access = MIXED,
) {
  useAuthStore.setState({
    accessToken: 'token',
    user: {
      id: 'u1',
      username: 'operator',
      fullName: 'Operator',
      email: null,
      roleCode,
      roleName: roleCode,
      departmentId: null,
      departmentName: null,
      permissions,
    },
  });
  render(
    <LanguageProvider>
      <RequirePermission anyOf={access.anyOf} allOf={access.allOf}>
        <p>Protected content</p>
      </RequirePermission>
    </LanguageProvider>,
  );
}

afterEach(() => {
  useAuthStore.setState({ accessToken: null, user: null });
});

describe('RequirePermission', () => {
  it('shows the denied alert listing required permissions', () => {
    renderGuard([]);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'ไม่มีสิทธิ์เข้าถึงหน้านี้' }),
    ).toBeInTheDocument();
    expect(screen.getByText('org:read')).toBeInTheDocument();
    expect(screen.getByText('dashboard:view')).toBeInTheDocument();
  });

  it('says "or" between anyOf and "and" for allOf in the denied copy', () => {
    renderGuard([]);

    expect(screen.getByText(/^บัญชีของคุณไม่มีสิทธิ์/)).toHaveTextContent(
      'บัญชีของคุณไม่มีสิทธิ์ (org:read หรือ settings:manage) และ dashboard:view',
    );
    const anyGroup = screen.getByLabelText(th['permission.requiredLabel']);
    expect(within(anyGroup).getAllByText(/:/).map((el) => el.textContent)).toEqual([
      'org:read',
      'settings:manage',
    ]);
    const allGroup = screen.getByLabelText(th['permission.requiredAllLabel']);
    expect(within(allGroup).getAllByText(/:/).map((el) => el.textContent)).toEqual([
      'dashboard:view',
    ]);
  });

  it('a single anyOf plus allOf is all-of: joined with "and", never "or"', () => {
    renderGuard([], 'VIEWER', { anyOf: ['streaming:live-wall'], allOf: ['streaming:view-live'] });

    const description = screen.getByText(/^บัญชีของคุณไม่มีสิทธิ์/);
    expect(description).toHaveTextContent('streaming:live-wall และ streaming:view-live');
    expect(description).not.toHaveTextContent(th['common.or']);
    expect(screen.queryByLabelText(th['permission.requiredLabel'])).toBeNull();
  });

  it('anyOf only keeps "or"', () => {
    renderGuard([], 'VIEWER', { anyOf: ['notifications:read', 'alerts:view'] });

    expect(screen.getByText(/^บัญชีของคุณไม่มีสิทธิ์/)).toHaveTextContent(
      'notifications:read หรือ alerts:view',
    );
    expect(screen.queryByLabelText(th['permission.requiredAllLabel'])).toBeNull();
  });

  it('passes with one anyOf and all allOf', () => {
    renderGuard(['org:read', 'dashboard:view']);
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it('denies when allOf is incomplete', () => {
    renderGuard(['org:read']);
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });

  it('lets ADMIN through', () => {
    renderGuard([], 'ADMIN');
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });
});

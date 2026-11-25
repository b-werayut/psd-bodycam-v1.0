import { render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { Can } from '@/components/Can';
import { useAuthStore, type AuthUser } from '@/stores/authStore';
import { usePermission } from './usePermission';

function user(roleCode: AuthUser['roleCode'], permissions: string[]): AuthUser {
  return {
    id: '1',
    username: 'u',
    firstName: 'U', lastName: '',
    email: null,
    roleCode,
    roleName: roleCode,
    permissions,
  };
}

describe('usePermission', () => {
  beforeEach(() => useAuthStore.setState({ accessToken: null, user: null }));

  it('false without a user', () => {
    expect(renderHook(() => usePermission('org:read')).result.current).toBe(false);
  });
  it('VIEWER checks codes (all / any)', () => {
    useAuthStore.setState({ user: user('VIEWER', ['org:read']) });
    expect(renderHook(() => usePermission('org:manage')).result.current).toBe(false);
    expect(renderHook(() => usePermission('org:read')).result.current).toBe(true);
    expect(renderHook(() => usePermission(['org:read', 'users:read'])).result.current).toBe(false);
    expect(renderHook(() => usePermission(['org:read', 'users:read'], 'any')).result.current).toBe(true);
  });
  it('SUPER_ADMIN with no permissions is allowed', () => {
    useAuthStore.setState({ user: user('SUPER_ADMIN', []) });
    expect(renderHook(() => usePermission('anything:manage')).result.current).toBe(true);
  });
  it('ADMIN has no bypass: it checks codes like any other role', () => {
    useAuthStore.setState({ user: user('ADMIN', ['users:manage']) });
    expect(renderHook(() => usePermission('users:manage')).result.current).toBe(true);
    expect(renderHook(() => usePermission('settings:manage')).result.current).toBe(false);
  });
  it('<Can> renders children or fallback', () => {
    useAuthStore.setState({ user: user('VIEWER', ['org:read']) });
    render(
      <>
        <Can permission="org:read">yes</Can>
        <Can permission="org:manage" fallback={<span>no</span>}>
          hidden
        </Can>
        <Can permission="org:manage">hidden2</Can>
      </>,
    );
    expect(screen.getByText('yes')).toBeInTheDocument();
    expect(screen.getByText('no')).toBeInTheDocument();
    expect(screen.queryByText(/hidden/)).toBeNull();
  });
});

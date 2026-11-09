import { render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { Can } from '@/components/Can';
import { useAuthStore, type AuthUser } from '@/stores/authStore';
import { usePermission } from './usePermission';

function user(roleCode: AuthUser['roleCode'], permissions: string[]): AuthUser {
  return {
    id: '1',
    username: 'u',
    fullName: 'U',
    email: null,
    roleCode,
    roleName: roleCode,
    departmentId: null,
    departmentName: null,
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
  it('ADMIN with no permissions is allowed', () => {
    useAuthStore.setState({ user: user('ADMIN', []) });
    expect(renderHook(() => usePermission('anything:manage')).result.current).toBe(true);
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

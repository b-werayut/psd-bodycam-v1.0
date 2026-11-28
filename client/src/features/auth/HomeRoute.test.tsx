import { cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithProviders, signIn, signOut } from '@/test/renderPage';
import { HomeRoute } from './HomeRoute';

afterEach(() => {
  cleanup();
  signOut();
});

describe('home workspaces', () => {
  it('offers real destinations to the administrator without disabled future modules', () => {
    signIn([], { roleCode: 'SUPER_ADMIN' });
    renderWithProviders(<MemoryRouter><HomeRoute /></MemoryRouter>);

    expect(screen.getByRole('link', { name: /ใบงาน/ })).toHaveAttribute('href', '/work-orders');
    expect(screen.getByRole('link', { name: /ตั้งค่าระบบ/ })).toHaveAttribute('href', '/settings');
    expect(screen.queryByRole('link', { name: /แจ้งเตือน/ })).not.toBeInTheDocument();
  });

  it('only offers workspaces the signed-in viewer can enter', () => {
    signIn(['dashboard:view', 'work-orders:read']);
    renderWithProviders(<MemoryRouter><HomeRoute /></MemoryRouter>);

    expect(screen.getByRole('link', { name: /ใบงาน/ })).toHaveAttribute('href', '/work-orders');
    expect(screen.queryByRole('link', { name: /ผู้ใช้ระบบ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /ตั้งค่าระบบ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /ภาพสดหลายจอ/ })).not.toBeInTheDocument();
  });
});

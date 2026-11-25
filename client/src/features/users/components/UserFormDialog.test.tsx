import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/apiClient';
import { renderWithProviders, signIn, signOut } from '../testUtils';
import { useAuthStore } from '@/stores/authStore';
import type { UserRow } from '../users.api';
import { UserFormDialog } from './UserFormDialog';

vi.mock('@/lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const account = (over: Partial<UserRow> = {}): UserRow => ({
  id: '7', username: 'somchai', firstName: 'สมชาย', lastName: 'ใจดี',
  email: 'somchai@example.test', phone: null, azureLinked: false,
  roleId: '2', roleCode: 'OPERATOR', roleName: 'เจ้าหน้าที่',
  status: 1, lastLoginAt: null, availableActions: ['edit'], ...over,
});

beforeEach(() => {
  vi.mocked(api.get).mockReset().mockResolvedValue({ data: { data: [
    { id: '2', code: 'OPERATOR', name: 'เจ้าหน้าที่', isSystem: true },
    { id: '3', code: 'VIEWER', name: 'ผู้ดูข้อมูล', isSystem: true },
  ], total: 2 } });
  vi.mocked(api.patch).mockReset().mockResolvedValue({ data: {} });
  vi.mocked(api.post).mockReset().mockResolvedValue({ data: {} });
});
afterEach(signOut);

describe('password visibility', () => {
  it.each(['create', 'edit'] as const)('toggles the %s password without clearing it or saving the form', async (mode) => {
    const events = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<UserFormDialog user={mode === 'edit' ? account() : undefined} onClose={onClose} />);
    const password = document.getElementById('user-password')!;
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('aria-describedby', 'user-password-description');
    await events.type(password, 'sample-password');
    await events.click(screen.getByRole('button', { name: 'แสดงรหัสผ่าน' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('sample-password');

    const hide = screen.getByRole('button', { name: 'ซ่อนรหัสผ่าน' });
    hide.focus();
    await events.keyboard(' ');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('sample-password');
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Microsoft-managed profile fields', () => {
  it.each([null, 'somchai@example.test'])('allows renaming an unlinked username with email %s', async (email) => {
    const events = userEvent.setup();
    renderWithProviders(<UserFormDialog user={account({ email })} onClose={vi.fn()} />);
    const username = document.getElementById('user-username')!;
    expect(username).toBeEnabled();
    await events.clear(username);
    await events.type(username, 'New.Name');
    await events.click(screen.getByRole('button', { name: /^บันทึก$/ }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/users/7', { username: 'new.name' }));
  });

  it('keeps a linked Microsoft username disabled', () => {
    renderWithProviders(<UserFormDialog user={account({ azureLinked: true })} onClose={vi.fn()} />);
    expect(document.getElementById('user-username')).toBeDisabled();
  });

  it('updates the signed-in username after renaming the current account', async () => {
    const events = userEvent.setup();
    signIn(['users:manage'], { id: '7', username: 'somchai', roleCode: 'ADMIN' });
    vi.mocked(api.patch).mockResolvedValue({ data: account({ username: 'new.name', roleCode: 'ADMIN' }) });
    renderWithProviders(<UserFormDialog user={account({ roleCode: 'ADMIN' })} onClose={vi.fn()} />);
    await events.clear(document.getElementById('user-username')!);
    await events.type(document.getElementById('user-username')!, 'new.name');
    await events.click(screen.getByRole('button', { name: /^บันทึก$/ }));
    await waitFor(() => expect(useAuthStore.getState().user?.username).toBe('new.name'));
  });
  it('keeps the UPN-derived username disabled when creating from Entra and allows a phone', async () => {
    const events = userEvent.setup();
    const { emptyUserForm } = await import('../userForm');
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    renderWithProviders(<UserFormDialog prefill={{
      ...emptyUserForm(), username: 'somchai', firstName: 'สมชาย', lastName: 'ใจดี',
      email: 'somchai@example.test', azureObjectId: 'oid-1', roleCode: 'VIEWER',
    }} onClose={vi.fn()} />);
    const username = document.getElementById('user-username')!;
    expect(username).toBeDisabled();
    const phone = screen.getByLabelText(/เบอร์โทร/);
    expect(phone).toBeEnabled();
    await events.type(phone, '0812345678');
    await events.click(screen.getByRole('button', { name: /^เพิ่มผู้ใช้$/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/users', expect.objectContaining({
      username: 'somchai', phone: '0812345678',
    })));
  });
  it.each([
    ['an account with email', account()],
    ['a linked account without email', account({ email: null, azureLinked: true })],
  ])('disables name, surname, and email for %s while allowing role changes', async (_label, user) => {
    const events = userEvent.setup();
    renderWithProviders(<UserFormDialog user={user} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    for (const id of ['user-firstname', 'user-lastname', 'user-email']) {
      expect(dialog.querySelector(`#${id}`)).toBeDisabled();
    }
    const role = within(dialog).getByRole('combobox');
    await waitFor(() => expect(role).toBeEnabled());
    await events.selectOptions(role, 'VIEWER');
    await events.click(within(dialog).getByRole('button', { name: /^บันทึก$/ }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/users/7', { roleCode: 'VIEWER' }));
  });

  it('keeps local profiles without email editable, including while entering their first email', async () => {
    const events = userEvent.setup();
    renderWithProviders(<UserFormDialog user={account({ email: null })} onClose={vi.fn()} />);
    const firstName = document.getElementById('user-firstname')!;
    const lastName = document.getElementById('user-lastname')!;
    const email = document.getElementById('user-email')!;
    expect(firstName).toBeEnabled();
    expect(lastName).toBeEnabled();
    expect(email).toBeEnabled();
    await events.clear(firstName);
    await events.type(firstName, 'สมหญิง');
    await events.type(email, 'somying@example.test');
    expect(email).toBeEnabled();
    expect(email).toHaveValue('somying@example.test');
    await events.click(screen.getByRole('button', { name: /^บันทึก$/ }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/users/7', {
      firstName: 'สมหญิง', email: 'somying@example.test',
    }));
  });
});

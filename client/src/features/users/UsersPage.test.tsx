import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/apiClient';
import { translate } from '@/i18n/translate';
import type { TranslationKey } from '@/i18n/locales/th';
import { UsersPage } from './UsersPage';
import { apiError, renderWithProviders, signIn, signOut } from './testUtils';
import type { UserRow } from './users.api';

vi.mock('@/lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const t = (key: TranslationKey, params?: Record<string, string | number>) =>
  translate('th', key, params);

const row = (over: Partial<UserRow>): UserRow => ({
  id: '7',
  username: 'field1',
  firstName: 'ช่างภาคสนาม', lastName: '',
  email: 'field1@psd.test',
  phone: null,
  roleId: '2',
  roleCode: 'OPERATOR',
  roleName: 'เจ้าหน้าที่',
  status: 1,
  lastLoginAt: null,
  azureLinked: false,
  availableActions: ['edit', 'suspend', 'delete'],
  ...over,
});

const ROWS = [
  row({ phone: '0812345678' }),
  row({
    id: '1',
    username: 'admin1',
    firstName: 'ผู้ดูแล', lastName: '',
    roleCode: 'SUPER_ADMIN',
    roleName: 'ผู้ดูแลระบบ',
    availableActions: ['edit'],
  }),
];

const RESERVED = ['audit:view', 'settings:manage', 'roles:manage'];

const ROLES = [
  { id: '1', code: 'SUPER_ADMIN', name: 'ผู้ดูแลระบบ', isSystem: true },
  { id: '2', code: 'OPERATOR', name: 'เจ้าหน้าที่', isSystem: true },
];

function mockGets(total = 2) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/users')
      return Promise.resolve({ data: { data: ROWS, page: 1, pageSize: 50, total } });
    if (url === '/roles')
      return Promise.resolve({ data: { data: ROLES, total: 2, reservedPermissions: RESERVED } });
    if (/^\/roles\/\d+\/permissions$/.test(url))
      return Promise.resolve({ data: { data: [], total: 0 } });
    return Promise.reject(new Error(`unmocked GET ${url}`));
  });
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.put).mockReset();
  vi.mocked(api.delete).mockReset();
  mockGets();
});
afterEach(signOut);

describe('UsersPage', () => {
  it('renders envelope rows and paginates', async () => {
    signIn(['users:read']);
    mockGets(120);
    renderWithProviders(<UsersPage />);

    expect(await screen.findByText('field1')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      t('users.column.username'),
      t('users.column.name'),
      t('users.column.role'),
      t('users.column.email'),
      t('users.column.phone'),
      t('users.column.azure'),
      t('users.column.statusLastLogin'),
    ]);
    expect(within(screen.getByText('field1').closest('tr')!).getByText('0812345678')).toBeInTheDocument();
    expect(screen.getByText(t('users.summary', { shown: 2, total: 120 }))).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', {
        name: t('common.pagination.nextPage', { label: t('users.tableCaption') }),
      }),
    );
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/users', {
        params: { page: 2, pageSize: 50 },
      }),
    );
  });

  it('shows the last login in Bangkok time', async () => {
    signIn(['users:read']);
    vi.mocked(api.get).mockImplementation((url: string) =>
      url === '/users'
        ? Promise.resolve({
            data: {
              data: [row({ lastLoginAt: '2026-11-04T17:30:00.000Z' })],
              page: 1,
              pageSize: 50,
              total: 1,
            },
          })
        : Promise.reject(new Error(`unmocked GET ${url}`)),
    );
    renderWithProviders(<UsersPage />);
    expect(await screen.findByText('5/11/69 00:30')).toBeInTheDocument();
  });

  it('empty state: its Add button is secondary (outline); the toolbar Add stays the one primary action', async () => {
    signIn(['users:read', 'users:manage']);
    vi.mocked(api.get).mockImplementation((url: string) =>
      url === '/users'
        ? Promise.resolve({ data: { data: [], page: 1, pageSize: 50, total: 0 } })
        : Promise.reject(new Error(`unmocked GET ${url}`)),
    );
    renderWithProviders(<UsersPage />);

    const empty = await screen.findByRole('status', { name: t('users.empty') });
    const emptyAdd = within(empty).getByRole('button', { name: t('users.newButton') });
    expect(emptyAdd).toHaveClass('border-input');
    expect(emptyAdd).not.toHaveClass('bg-primary');
    const toolbar = screen.getByRole('toolbar', { name: t('users.toolbar') });
    expect(within(toolbar).getByRole('button', { name: t('users.newButton') })).toHaveClass(
      'bg-primary',
    );
  });

  it('shows no management tools to a read-only viewer', async () => {
    signIn(['dashboard:view'], { roleCode: 'VIEWER' });
    renderWithProviders(<UsersPage />);

    await screen.findByText('field1');
    expect(screen.queryByRole('button', { name: t('users.editUser', { name: 'field1' }) })).toBeNull();
    expect(
      screen.queryByRole('button', { name: t('users.moreActions', { name: 'field1' }) }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: t('users.newButton') })).toBeNull();
    expect(screen.queryByRole('tab', { name: t('users.tab.roles') })).toBeNull();
  });

  it('suspends a user after confirmation and shows a success toast', async () => {
    signIn(['users:read', 'users:manage']);
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    renderWithProviders(<UsersPage />);

    await screen.findByText('field1');
    await userEvent.click(
      screen.getByRole('button', { name: t('users.moreActions', { name: 'field1' }) }),
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: t('users.suspendUser', { name: 'field1' }) }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(api.patch).not.toHaveBeenCalled();
    await userEvent.click(
      within(dialog).getByRole('button', { name: t('users.suspendConfirmLabel') }),
    );

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/users/7/access', { enabled: false }),
    );
    expect(await screen.findByText(t('users.suspendedToast'))).toBeInTheDocument();
  });

  it('shows only the row actions the server allows', async () => {
    signIn(['users:read', 'users:manage'], { id: '1' });
    renderWithProviders(<UsersPage />);

    await screen.findByText('admin1');
    // own row: the server sends ['edit'] => edit button, no suspend / delete menu
    expect(
      screen.getByRole('button', { name: t('users.editUser', { name: 'admin1' }) }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: t('users.moreActions', { name: 'admin1' }) }),
    ).toBeNull();

    await userEvent.click(
      screen.getByRole('button', { name: t('users.moreActions', { name: 'field1' }) }),
    );
    expect(
      await screen.findByRole('menuitem', { name: t('users.suspendUser', { name: 'field1' }) }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: t('users.deleteUser', { name: 'field1' }) }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: t('users.restoreUser', { name: 'field1' }) }),
    ).toBeNull();
  });

  it('offers restore (not suspend) when the server says so', async () => {
    signIn(['users:read', 'users:manage']);
    vi.mocked(api.get).mockImplementation((url: string) =>
      url === '/users'
        ? Promise.resolve({
            data: {
              data: [row({ status: 2, availableActions: ['edit', 'restore', 'delete'] })],
              page: 1,
              pageSize: 50,
              total: 1,
            },
          })
        : Promise.reject(new Error(`unmocked GET ${url}`)),
    );
    renderWithProviders(<UsersPage />);
    await screen.findByText('field1');
    await userEvent.click(
      screen.getByRole('button', { name: t('users.moreActions', { name: 'field1' }) }),
    );
    expect(
      await screen.findByRole('menuitem', { name: t('users.restoreUser', { name: 'field1' }) }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: t('users.suspendUser', { name: 'field1' }) }),
    ).toBeNull();
  });

  it('shows the roles tab read-only for users:read without roles:manage', async () => {
    signIn(['users:read', 'users:manage'], { roleCode: 'ADMIN' });
    renderWithProviders(<UsersPage />);
    await userEvent.click(await screen.findByRole('tab', { name: t('users.tab.roles') }));
    expect(await screen.findByText(t('users.permissions.readOnlyHint'))).toBeInTheDocument();
    const boxes = await screen.findAllByRole('checkbox');
    for (const box of boxes) expect(box).toBeDisabled();
    expect(screen.queryByRole('button', { name: t('users.roles.save') })).toBeNull();
  });

  it('shows the backend message under the username field on 409 USERNAME_TAKEN', async () => {
    signIn(['users:read', 'users:manage']);
    vi.mocked(api.post).mockRejectedValue(
      apiError(409, {
        statusCode: 409,
        code: 'USERNAME_TAKEN',
        message: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว',
        correlationId: 'c1',
      }),
    );
    renderWithProviders(<UsersPage />);

    await screen.findByText('field1');
    await userEvent.click(screen.getByRole('button', { name: t('users.newButton') }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.type(within(dialog).getByLabelText(t('users.form.username')), 'Field1');
    await userEvent.type(within(dialog).getByLabelText(t('users.form.firstName')), 'ซ้ำ');
    await waitFor(() =>
      expect(within(dialog).getByRole('option', { name: 'เจ้าหน้าที่' })).toBeInTheDocument(),
    );
    await userEvent.selectOptions(within(dialog).getByLabelText(t('users.form.role')), 'OPERATOR');
    await userEvent.click(within(dialog).getByRole('button', { name: t('users.form.create') }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/users', {
        username: 'field1',
        firstName: 'ซ้ำ', lastName: '',
        roleCode: 'OPERATOR',
      }),
    );
    const error = await waitFor(() => {
      const el = dialog.querySelector('#user-username-error');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(error).toHaveTextContent('ชื่อผู้ใช้นี้ถูกใช้แล้ว');
  });

  it('a 403 on the list shows the server message (not "check your connection")', async () => {
    signIn(['users:read']);
    const message = 'คุณไม่มีสิทธิ์ดูรายชื่อผู้ใช้';
    vi.mocked(api.get).mockImplementation((url: string) =>
      url === '/users'
        ? Promise.reject(
            apiError(403, { statusCode: 403, code: 'FORBIDDEN', message, correlationId: 'c3' }),
          )
        : Promise.reject(new Error(`unmocked GET ${url}`)),
    );
    renderWithProviders(<UsersPage />);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(t('common.loadFailed'))).toBeInTheDocument();
    expect(within(alert).getByText(message)).toBeInTheDocument();
    expect(screen.queryByText(t('common.checkConnection'))).toBeNull();
  });

  it('titles the page like its menu item', async () => {
    signIn(['users:read']);
    renderWithProviders(<UsersPage />);
    expect(
      await screen.findByRole('heading', { level: 1, name: t('navigation.users') }),
    ).toHaveTextContent('ผู้ใช้ระบบ');
  });

  it('the user form asks only for account fields and a role', async () => {
    signIn(['users:read', 'users:manage']);
    renderWithProviders(<UsersPage />);
    await screen.findByText('field1');
    await userEvent.click(screen.getByRole('button', { name: t('users.newButton') }));
    const dialog = await screen.findByRole('dialog');
    // the role is the only select: there is no department to pick
    expect(within(dialog).getAllByRole('combobox')).toEqual([
      within(dialog).getByLabelText(t('users.form.role')),
    ]);
  });

  it('shows the roles tab to roles:manage', async () => {
    signIn(['users:read', 'roles:manage']);
    renderWithProviders(<UsersPage />);
    expect(await screen.findByRole('tab', { name: t('users.tab.roles') })).toBeInTheDocument();
  });
});

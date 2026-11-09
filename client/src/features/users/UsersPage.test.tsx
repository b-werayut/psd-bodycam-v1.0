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
  fullName: 'ช่างภาคสนาม',
  email: 'field1@psd.test',
  roleId: '2',
  roleCode: 'OPERATOR',
  roleName: 'เจ้าหน้าที่',
  departmentId: '3',
  departmentName: 'ศูนย์ควบคุม',
  status: 1,
  lastLoginAt: null,
  azureLinked: false,
  ...over,
});

const ROWS = [
  row({}),
  row({ id: '1', username: 'admin1', fullName: 'ผู้ดูแล', roleCode: 'ADMIN', roleName: 'ผู้ดูแลระบบ' }),
];

const ROLES = [
  { id: '1', code: 'ADMIN', name: 'ผู้ดูแลระบบ', isSystem: true },
  { id: '2', code: 'OPERATOR', name: 'เจ้าหน้าที่', isSystem: true },
];
const TREE = [
  {
    id: '3',
    code: 'CC',
    name: 'ศูนย์ควบคุม',
    parentId: null,
    isActive: true,
    children: [],
  },
];

function mockGets(total = 2) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/users')
      return Promise.resolve({ data: { data: ROWS, page: 1, pageSize: 50, total } });
    if (url === '/roles') return Promise.resolve({ data: { data: ROLES, total: 2 } });
    if (url === '/departments/tree') return Promise.resolve({ data: { data: TREE, total: 1 } });
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
    expect(screen.getAllByText('ศูนย์ควบคุม')).toHaveLength(2);
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
    signIn(['users:read'], { roleCode: 'VIEWER' });
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

  it('disables suspend and delete on the own row with a reason', async () => {
    signIn(['users:read', 'users:manage'], { id: '1' });
    renderWithProviders(<UsersPage />);

    await screen.findByText('admin1');
    await userEvent.click(
      screen.getByRole('button', { name: t('users.moreActions', { name: 'admin1' }) }),
    );
    const suspend = await screen.findByRole('menuitem', {
      name: new RegExp(t('users.suspendUser', { name: 'admin1' })),
    });
    expect(suspend).toHaveAttribute('aria-disabled', 'true');
    expect(within(suspend).getByText(t('users.cannotSuspendSelf'))).toBeInTheDocument();
    const del = screen.getByRole('menuitem', {
      name: new RegExp(t('users.deleteUser', { name: 'admin1' })),
    });
    expect(del).toHaveAttribute('aria-disabled', 'true');
    expect(within(del).getByText(t('users.cannotDeleteSelf'))).toBeInTheDocument();
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
    await userEvent.type(within(dialog).getByLabelText(t('users.form.fullName')), 'ซ้ำ');
    await waitFor(() =>
      expect(within(dialog).getByRole('option', { name: 'เจ้าหน้าที่' })).toBeInTheDocument(),
    );
    await userEvent.selectOptions(within(dialog).getByLabelText(t('users.form.role')), 'OPERATOR');
    await userEvent.selectOptions(within(dialog).getByLabelText(t('users.form.department')), '3');
    await userEvent.click(within(dialog).getByRole('button', { name: t('users.form.create') }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/users', {
        username: 'field1',
        fullName: 'ซ้ำ',
        roleCode: 'OPERATOR',
        departmentId: '3',
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
    const message = 'คุณไม่มีสิทธิ์ดูผู้ใช้ของหน่วยงานนี้';
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

  it('shows the roles tab to roles:manage', async () => {
    signIn(['users:read', 'roles:manage']);
    renderWithProviders(<UsersPage />);
    expect(await screen.findByRole('tab', { name: t('users.tab.roles') })).toBeInTheDocument();
  });
});

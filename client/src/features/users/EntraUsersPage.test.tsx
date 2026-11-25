import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/apiClient';
import { translate } from '@/i18n/translate';
import type { TranslationKey } from '@/i18n/locales/th';
import { EntraUsersPage } from './EntraUsersPage';
import { apiError, renderWithProviders, signIn, signOut } from './testUtils';
import type { EntraDirectoryUser, EntraSyncResult } from './users.api';

vi.mock('@/lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const t = (key: TranslationKey, params?: Record<string, string | number>) =>
  translate('th', key, params);

const entraUser = (upn: string, over: Partial<EntraDirectoryUser> = {}): EntraDirectoryUser => ({
  id: `oid-${upn.slice(0, upn.indexOf('@'))}`,
  userPrincipalName: upn,
  displayName: `ชื่อ ${upn.slice(0, upn.indexOf('@'))}`,
  mail: null,
  mobilePhone: null,
  accountEnabled: true,
  userType: 'Member',
  ...over,
});

const directory = (over: Partial<EntraSyncResult> = {}): EntraSyncResult => ({
  dryRun: true,
  entraTotal: 5,
  entraFetched: 5,
  entraDroppedByDomain: 0,
  filteredAtGraph: true,
  allowedDomains: [],
  domainFilteredAtGraph: false,
  domainField: 'userPrincipalName',
  applied: 0,
  unchanged: 1,
  updates: [],
  missingInSystem: [
    { upn: 'somchai@psd.co.th', displayName: 'ชื่อ somchai', oid: 'oid-somchai' },
    { upn: 'somkid@psd.co.th', displayName: 'ชื่อ somkid', oid: 'oid-somkid' },
    { upn: 'somying@psd.co.th', displayName: 'ชื่อ somying', oid: 'oid-somying' },
  ],
  notInEntra: [],
  conflicts: [
    {
      upn: 'taken@psd.co.th',
      username: 'taken',
      reason: 'boundToAnotherAzureAccount',
      detail: "บัญชี 'taken' ผูกกับ oid อื่นอยู่แล้ว",
    },
  ],
  entraFields: [],
  entraUsers: [
    entraUser('somsri@psd.co.th', { jobTitle: 'ช่างติดตั้ง', employeeId: 'EMP-777' }),
    entraUser('somchai@psd.co.th'),
    entraUser('somkid@psd.co.th'),
    entraUser('somying@psd.co.th'),
    entraUser('taken@psd.co.th'),
  ],
  ...over,
});

/** The server leaves SUPER_ADMIN out of GET /roles for a non-SUPER_ADMIN caller. */
const ROLES = [
  { id: '2', code: 'ADMIN', name: 'ผู้ดูแลบริษัท', isSystem: true },
  { id: '3', code: 'OPERATOR', name: 'เจ้าหน้าที่ปฏิบัติการ', isSystem: true },
  { id: '4', code: 'VIEWER', name: 'ผู้ดูข้อมูล', isSystem: true },
  { id: '5', code: 'TEAM_LEADER', name: 'หัวหน้าทีม', isSystem: true },
];

function mockGets(result: EntraSyncResult = directory()) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/users/entra-directory') return Promise.resolve({ data: result });
    if (url === '/roles')
      return Promise.resolve({
        data: { data: ROLES, total: ROLES.length, reservedPermissions: ['audit:view'] },
      });
    return Promise.reject(new Error(`unmocked GET ${url}`));
  });
}

const createdRow = (payload: { username: string; firstName: string; lastName: string; roleCode: string }) => ({
  data: {
    id: '99',
    username: payload.username,
    firstName: payload.firstName, lastName: payload.lastName,
    email: null,
    roleId: '3',
    roleCode: payload.roleCode,
    roleName: 'เจ้าหน้าที่ปฏิบัติการ',
    status: 1,
    lastLoginAt: null,
    azureLinked: true,
    availableActions: ['edit'],
  },
});

const tableOf = () => screen.getByRole('table', { name: t('users.entraSync.tableCaption') });
const rowOf = (upn: string) => within(tableOf()).getByRole('row', { name: new RegExp(upn) });

async function openBulkForAllMissing(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText('somsri@psd.co.th');
  await user.click(screen.getByRole('checkbox', { name: t('users.entraSync.bulk.selectPage') }));
  await user.click(
    screen.getByRole('button', { name: t('users.entraSync.bulk.open', { count: 3 }) }),
  );
  return screen.getByRole('dialog', { name: t('users.entraSync.bulk.title') });
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  mockGets();
  signIn(['users:read', 'users:manage'], { roleCode: 'ADMIN' });
});
afterEach(signOut);

describe('EntraUsersPage', () => {
  it('omits directory scope details while keeping the filtering controls', async () => {
    mockGets(directory({
      allowedDomains: ['psdconstruction2011.com'],
      domainFilteredAtGraph: true,
    }));
    renderWithProviders(<EntraUsersPage />);
    await screen.findByText('somsri@psd.co.th');
    expect(screen.queryByRole('list', { name: t('users.entraSync.scopeLabel') })).not.toBeInTheDocument();
    expect(screen.queryByText(t('users.entraSync.scope.activeMembersOnly'))).not.toBeInTheDocument();
    expect(screen.queryByText(t('users.entraSync.scope.nonHumanWarning'))).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: t('users.entraSync.onlyMissing') })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: t('users.entraSync.matchByUsername') })).toBeEnabled();
  });

  it('lists directory rows with their status', async () => {
    renderWithProviders(<EntraUsersPage />);

    expect(await screen.findByText('somsri@psd.co.th')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/users/entra-directory');

    const linked = within(rowOf('somsri@psd.co.th')).getByText(
      t('users.entraSync.rowStatus.linked'),
    );
    expect(linked.closest('[data-tone]')).toHaveAttribute('data-tone', 'success');

    const missing = within(rowOf('somchai@psd.co.th')).getByText(
      t('users.entraSync.rowStatus.missing'),
    );
    expect(missing.closest('[data-tone]')).toHaveAttribute('data-tone', 'neutral');

    const conflictRow = rowOf('taken@psd.co.th');
    const conflict = within(conflictRow).getByText(t('users.entraSync.rowStatus.conflict'));
    expect(conflict.closest('[data-tone]')).toHaveAttribute('data-tone', 'destructive');
    expect(
      within(conflictRow).getByText(t('users.entraSync.conflict.boundToAnotherAzureAccount')),
    ).toBeInTheDocument();

    expect(screen.getByRole('group', { name: t('users.entraSync.counts.missingInSystem') }))
      .toHaveTextContent('3');
  });

  it('creates several accounts with one role and reports partial failures', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post)
      .mockImplementationOnce((_url, payload) => Promise.resolve(createdRow(payload as never)))
      .mockImplementationOnce(() =>
        Promise.reject(
          apiError(409, {
            statusCode: 409,
            code: 'USERNAME_TAKEN',
            message: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว',
            correlationId: 'c1',
          }),
        ),
      )
      .mockImplementationOnce((_url, payload) => Promise.resolve(createdRow(payload as never)));
    renderWithProviders(<EntraUsersPage />);

    const dialog = await openBulkForAllMissing(user);
    await waitFor(() =>
      expect(within(dialog).getByRole('option', { name: 'เจ้าหน้าที่ปฏิบัติการ' })).toBeInTheDocument(),
    );
    await user.selectOptions(within(dialog).getByLabelText(t('users.form.role')), 'OPERATOR');
    await user.click(
      within(dialog).getByRole('button', { name: t('users.entraSync.bulk.confirm', { count: 3 }) }),
    );

    expect(
      await within(dialog).findByText(
        t('users.entraSync.bulk.doneSummary', { created: 2, failed: 1 }),
      ),
    ).toBeInTheDocument();
    expect(t('users.entraSync.bulk.doneSummary', { created: 2, failed: 1 })).toBe(
      'สร้างแล้ว 2 · ไม่สำเร็จ 1',
    );

    expect(api.post).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(api.post).mock.calls;
    expect(calls.map(([url]) => url)).toEqual(['/users', '/users', '/users']);
    expect(calls.map(([, body]) => body)).toEqual([
      {
        username: 'somchai',
        firstName: 'ชื่อ', lastName: 'somchai',
        email: 'somchai@psd.co.th',
        roleCode: 'OPERATOR',
        azureObjectId: 'oid-somchai',
      },
      {
        username: 'somkid',
        firstName: 'ชื่อ', lastName: 'somkid',
        email: 'somkid@psd.co.th',
        roleCode: 'OPERATOR',
        azureObjectId: 'oid-somkid',
      },
      {
        username: 'somying',
        firstName: 'ชื่อ', lastName: 'somying',
        email: 'somying@psd.co.th',
        roleCode: 'OPERATOR',
        azureObjectId: 'oid-somying',
      },
    ]);

    const failed = within(dialog).getByText('ชื่อผู้ใช้นี้ถูกใช้แล้ว').closest('li');
    expect(failed).toHaveTextContent('somkid');
    expect(failed).toHaveTextContent(t('users.entraSync.bulk.failed'));
    const created = within(dialog).getByText('somying@psd.co.th', { exact: false }).closest('li');
    expect(created).toHaveTextContent(t('users.entraSync.bulk.created'));
  });

  it('shows the server message when Graph is not configured', async () => {
    const message =
      'ยังไม่ได้ตั้งค่าเชื่อม Microsoft Graph: ยังไม่ได้ตั้ง GRAPH_CLIENT_ID — ต้องใช้ App registration แยกจากที่ใช้ทำ SSO';
    vi.mocked(api.get).mockImplementation((url: string) =>
      url === '/users/entra-directory'
        ? Promise.reject(
            apiError(400, { statusCode: 400, code: 'GRAPH_NOT_CONFIGURED', message }),
          )
        : Promise.reject(new Error(`unmocked GET ${url}`)),
    );
    renderWithProviders(<EntraUsersPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('users.entraSync.loadFailed'));
    expect(alert).toHaveTextContent(message);
    expect(screen.getByRole('heading', { level: 1, name: t('users.entraSync.title') }))
      .toBeInTheDocument();
  });

  it('role picker comes from GET /roles', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntraUsersPage />);

    const dialog = await openBulkForAllMissing(user);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/roles'));
    const select = within(dialog).getByLabelText(t('users.form.role'));
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(5));

    const values = within(select)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
    expect(values).toEqual(['', 'ADMIN', 'OPERATOR', 'VIEWER', 'TEAM_LEADER']);
    expect(values).not.toContain('SUPER_ADMIN');
  });

  it('keeps the bulk confirm disabled until a role is picked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntraUsersPage />);

    const dialog = await openBulkForAllMissing(user);
    expect(
      within(dialog).getByRole('button', { name: t('users.entraSync.bulk.confirm', { count: 3 }) }),
    ).toBeDisabled();
  });

  it('offers selection only on rows that have no account yet', async () => {
    renderWithProviders(<EntraUsersPage />);

    await screen.findByText('somsri@psd.co.th');
    expect(
      screen.getAllByRole('checkbox', { name: /^เลือก .* เพื่อสร้างบัญชี$/ }),
    ).toHaveLength(3);
    expect(
      screen.queryByRole('checkbox', {
        name: t('users.entraSync.bulk.selectRow', { upn: 'somsri@psd.co.th' }),
      }),
    ).not.toBeInTheDocument();
    expect(
      within(rowOf('somsri@psd.co.th')).getByText(t('users.entraSync.actionHasAccount')),
    ).toBeInTheDocument();
    expect(
      within(rowOf('taken@psd.co.th')).getByText(t('users.entraSync.actionNeedsReview')),
    ).toBeInTheDocument();
  });

  it('creates one account from a row with the Entra values and no password', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockImplementation((_url, payload) =>
      Promise.resolve(createdRow(payload as never)),
    );
    renderWithProviders(<EntraUsersPage />);

    await screen.findByText('somsri@psd.co.th');
    await user.click(
      screen.getByRole('button', {
        name: t('users.entraSync.createUserFor', { upn: 'somchai@psd.co.th' }),
      }),
    );

    const dialog = screen.getByRole('dialog', { name: t('users.form.createTitle') });
    expect(within(dialog).getByText(t('users.form.entraDescription'))).toBeInTheDocument();
    expect(within(dialog).getByLabelText(t('users.form.username'))).toHaveValue('somchai');
    expect(within(dialog).getByLabelText(t('users.form.firstName'))).toHaveValue('ชื่อ');
    expect(within(dialog).getByLabelText(t('users.form.firstName'))).toBeDisabled();
    expect(within(dialog).getByLabelText(t('users.form.lastName'), { exact: false })).toHaveValue('somchai');
    expect(within(dialog).getByLabelText(t('users.form.lastName'), { exact: false })).toBeDisabled();
    expect(within(dialog).getByLabelText(/อีเมล/)).toHaveValue('somchai@psd.co.th');
    expect(within(dialog).getByLabelText(/อีเมล/)).toBeDisabled();
    expect(within(dialog).queryByLabelText(/รหัสผ่าน/)).not.toBeInTheDocument();

    await waitFor(() =>
      expect(within(dialog).getByRole('option', { name: 'ผู้ดูข้อมูล' })).toBeInTheDocument(),
    );
    await user.selectOptions(within(dialog).getByLabelText(t('users.form.role')), 'VIEWER');
    await user.click(within(dialog).getByRole('button', { name: t('users.form.create') }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/users', {
      username: 'somchai',
      firstName: 'ชื่อ', lastName: 'somchai',
      email: 'somchai@psd.co.th',
      roleCode: 'VIEWER',
      azureObjectId: 'oid-somchai',
    });
  });

  it('links an existing account to its Entra row', async () => {
    const user = userEvent.setup();
    mockGets(
      directory({
        updates: [
          {
            userId: '25',
            username: 'devmeen',
            upn: 'somsri@psd.co.th',
            patch: { AzureObjectId: 'oid-somsri' },
            keptLocal: [],
          },
        ],
      }),
    );
    vi.mocked(api.patch).mockResolvedValue({ data: {} });
    renderWithProviders(<EntraUsersPage />);

    await user.click(
      await screen.findByRole('button', {
        name: t('users.entraSync.linkUserFor', { upn: 'somsri@psd.co.th', username: 'devmeen' }),
      }),
    );

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/users/25', { azureObjectId: 'oid-somsri' }),
    );
    expect((await screen.findAllByText(t('users.entraSync.linkSucceeded'))).length).toBeGreaterThan(
      0,
    );
  });

  it('shows the server message when linking fails', async () => {
    const user = userEvent.setup();
    mockGets(
      directory({
        updates: [
          {
            userId: '25',
            username: 'devmeen',
            upn: 'somsri@psd.co.th',
            patch: { AzureObjectId: 'oid-somsri' },
            keptLocal: [],
          },
        ],
      }),
    );
    vi.mocked(api.patch).mockRejectedValue(
      apiError(409, { code: 'AZURE_ACCOUNT_TAKEN', message: 'บัญชี Microsoft นี้ผูกกับผู้ใช้อื่นแล้ว' }),
    );
    renderWithProviders(<EntraUsersPage />);

    await user.click(
      await screen.findByRole('button', {
        name: t('users.entraSync.linkUserFor', { upn: 'somsri@psd.co.th', username: 'devmeen' }),
      }),
    );

    expect(
      (await screen.findAllByText('บัญชี Microsoft นี้ผูกกับผู้ใช้อื่นแล้ว')).length,
    ).toBeGreaterThan(0);
  });

  it('applies the sync only after confirming', async () => {
    const user = userEvent.setup();
    const planned = directory({
      updates: [
        {
          userId: '25',
          username: 'devmeen',
          upn: 'somsri@psd.co.th',
          patch: { AzureObjectId: 'oid-somsri', FirstName: 'ชื่อ', LastName: 'somsri' },
          keptLocal: [],
        },
      ],
    });
    mockGets(planned);
    vi.mocked(api.post).mockResolvedValue({
      data: { ...planned, dryRun: false, applied: 1, unchanged: 1 },
    });
    renderWithProviders(<EntraUsersPage />);

    await screen.findByText('somsri@psd.co.th');
    await user.click(screen.getByRole('button', { name: t('users.entraSync.apply', { count: 1 }) }));
    expect(api.post).not.toHaveBeenCalled();

    const confirm = screen.getByRole('dialog', { name: t('users.entraSync.applyConfirmTitle') });
    await user.click(
      within(confirm).getByRole('button', {
        name: t('users.entraSync.applyConfirmLabel', { count: 1 }),
      }),
    );

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/users/sync-entra', {
        dryRun: false,
        matchByUsername: false,
      }),
    );
    expect(
      (
        await screen.findAllByText(
          t('users.entraSync.appliedSummary', { applied: 1, unchanged: 1 }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });

  it('disables the apply button when nothing would change', async () => {
    renderWithProviders(<EntraUsersPage />);

    await screen.findByText('somsri@psd.co.th');
    expect(screen.getByRole('button', { name: t('users.entraSync.apply', { count: 0 }) }))
      .toBeDisabled();
  });

  it('re-plans with username matching when asked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.post).mockResolvedValue({ data: directory() });
    renderWithProviders(<EntraUsersPage />);

    await screen.findByText('somsri@psd.co.th');
    await user.click(screen.getByRole('checkbox', { name: t('users.entraSync.matchByUsername') }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/users/sync-entra', {
        dryRun: true,
        matchByUsername: true,
      }),
    );
    expect(screen.getByText(t('users.entraSync.matchByUsernameHint'))).toBeInTheDocument();
  });

  it('filters to rows without an account and searches', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntraUsersPage />);

    await screen.findByText('somsri@psd.co.th');
    await user.click(screen.getByRole('checkbox', { name: t('users.entraSync.onlyMissing') }));
    expect(screen.queryByText('somsri@psd.co.th')).not.toBeInTheDocument();
    expect(screen.getByText('somchai@psd.co.th')).toBeInTheDocument();

    await user.type(screen.getByLabelText(t('users.entraSync.search')), 'somkid');
    expect(screen.queryByText('somchai@psd.co.th')).not.toBeInTheDocument();
    expect(screen.getByText('somkid@psd.co.th')).toBeInTheDocument();

    await user.clear(screen.getByLabelText(t('users.entraSync.search')));
    await user.type(screen.getByLabelText(t('users.entraSync.search')), 'ไม่มีคนนี้');
    expect(screen.getByText(t('users.entraSync.filteredEmpty'))).toBeInTheDocument();
  });

  it('shows extra Entra fields on demand', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EntraUsersPage />);

    await screen.findByText('somsri@psd.co.th');
    expect(screen.getByText('ช่างติดตั้ง')).toBeInTheDocument();
    expect(screen.queryByText('EMP-777')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: t('users.entraSync.field.employeeId') }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /แสดงทุกฟิลด์/ }));
    expect(screen.getByText('EMP-777')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: t('users.entraSync.field.employeeId') }),
    ).toBeInTheDocument();
  });

  it('pages 50 rows at a time', async () => {
    const user = userEvent.setup();
    mockGets(
      directory({
        entraTotal: 60,
        missingInSystem: [],
        conflicts: [],
        entraUsers: Array.from({ length: 60 }, (_, index) =>
          entraUser(`user${String(index).padStart(2, '0')}@psd.co.th`),
        ),
      }),
    );
    renderWithProviders(<EntraUsersPage />);

    expect(
      await screen.findByText(t('users.entraSync.summary', { from: 1, to: 50, total: 60 })),
    ).toBeInTheDocument();
    expect(screen.getByText('user00@psd.co.th')).toBeInTheDocument();
    expect(screen.queryByText('user50@psd.co.th')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: t('common.pagination.goToPage', {
          page: 2,
          label: t('users.entraSync.tableCaption'),
        }),
      }),
    );
    expect(
      screen.getByText(t('users.entraSync.summary', { from: 51, to: 60, total: 60 })),
    ).toBeInTheDocument();
    expect(screen.getByText('user50@psd.co.th')).toBeInTheDocument();
  });

  it('shows an empty state when Entra returns nobody', async () => {
    mockGets(
      directory({ entraTotal: 0, entraUsers: [], missingInSystem: [], conflicts: [], unchanged: 0 }),
    );
    renderWithProviders(<EntraUsersPage />);

    expect(await screen.findByText(t('users.entraSync.empty'))).toBeInTheDocument();
    expect(screen.getByText(t('users.entraSync.emptyHint'))).toBeInTheDocument();
  });
});

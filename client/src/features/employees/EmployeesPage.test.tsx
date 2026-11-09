import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DepartmentNode } from '@/features/departments/departments.api';
import type { TranslationKey } from '@/i18n/locales/th';
import { translate } from '@/i18n/translate';
import { api } from '@/lib/apiClient';
import { apiError, renderWithProviders, signIn, signOut } from '@/test/renderPage';
import { EmployeesPage } from './EmployeesPage';
import type { EmployeeRow } from './employees.api';

vi.mock('@/lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const t = (key: TranslationKey, params?: Record<string, string | number>) =>
  translate('th', key, params);

const emp = (over: Partial<EmployeeRow>): EmployeeRow => ({
  id: '9',
  employeeCode: 'E001',
  firstName: 'สมชาย',
  lastName: 'ใจดี',
  phone: '0812345678',
  departmentId: '3',
  departmentName: 'ศูนย์ควบคุม',
  userId: null,
  bookingEmployeeRef: null,
  status: 1,
  ...over,
});

const TREE: DepartmentNode[] = [
  { id: '3', code: 'CC', name: 'ศูนย์ควบคุม', parentId: null, isActive: true, children: [] },
  { id: '4', code: 'IT', name: 'ไอที', parentId: null, isActive: true, children: [] },
];

function mockGets(rows: EmployeeRow[] = [emp({})]) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/employees')
      return Promise.resolve({ data: { data: rows, page: 1, pageSize: 50, total: rows.length } });
    if (url === '/departments/tree') return Promise.resolve({ data: { data: TREE, total: 2 } });
    if (url === '/users')
      return Promise.resolve({ data: { data: [], page: 1, pageSize: 100, total: 0 } });
    return Promise.reject(new Error(`unmocked GET ${url}`));
  });
}

beforeEach(() => {
  for (const fn of [api.get, api.post, api.patch, api.put, api.delete]) vi.mocked(fn).mockReset();
  mockGets();
});
afterEach(signOut);

describe('EmployeesPage', () => {
  it('renders envelope rows', async () => {
    signIn(['org:read']);
    renderWithProviders(<EmployeesPage />);
    expect(await screen.findByText('E001')).toBeInTheDocument();
    expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText(t('employees.status.active'))).toBeInTheDocument();
    expect(screen.getByText(t('employees.summary', { shown: 1, total: 1 }))).toBeInTheDocument();
  });

  it('filtering by department updates the query params', async () => {
    signIn(['org:read']);
    renderWithProviders(<EmployeesPage />);
    await screen.findByText('E001');
    await userEvent.selectOptions(screen.getByLabelText(t('employees.filter.department')), '4');
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/employees', {
        params: { page: 1, pageSize: 50, departmentId: '4' },
      }),
    );
  });

  it('filtering by status updates the query params', async () => {
    signIn(['org:read']);
    renderWithProviders(<EmployeesPage />);
    await screen.findByText('E001');
    await userEvent.selectOptions(screen.getByLabelText(t('employees.filter.status')), '3');
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/employees', {
        params: { page: 1, pageSize: 50, status: 3 },
      }),
    );
  });

  it('empty state: its Add button is secondary (outline); the toolbar Add stays the one primary action', async () => {
    signIn(['org:read', 'org:manage']);
    mockGets([]);
    renderWithProviders(<EmployeesPage />);

    const empty = await screen.findByRole('status', { name: t('employees.empty') });
    const emptyAdd = within(empty).getByRole('button', { name: t('employees.newButton') });
    expect(emptyAdd).toHaveClass('border-input');
    expect(emptyAdd).not.toHaveClass('bg-primary');
    const toolbar = screen.getByRole('toolbar', { name: t('employees.toolbar') });
    expect(within(toolbar).getByRole('button', { name: t('employees.newButton') })).toHaveClass(
      'bg-primary',
    );
  });

  it('shows empty vs filtered-empty states', async () => {
    signIn(['org:read']);
    mockGets([]);
    renderWithProviders(<EmployeesPage />);
    expect(await screen.findByText(t('employees.empty'))).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(t('employees.filter.department')), '4');
    expect(await screen.findByText(t('employees.filteredEmpty'))).toBeInTheDocument();
    expect(screen.queryByText(t('employees.empty'))).toBeNull();
  });

  it('hides write tools without org:manage', async () => {
    signIn(['org:read']);
    renderWithProviders(<EmployeesPage />);
    await screen.findByText('E001');
    expect(screen.queryByRole('button', { name: t('employees.newButton') })).toBeNull();
    expect(
      screen.queryByRole('button', { name: t('employees.editEmployee', { name: 'E001' }) }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: t('employees.moreActions', { name: 'E001' }) }),
    ).toBeNull();
  });

  it('shows write tools with org:manage', async () => {
    signIn(['org:read', 'org:manage']);
    renderWithProviders(<EmployeesPage />);
    await screen.findByText('E001');
    expect(screen.getByRole('button', { name: t('employees.newButton') })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t('employees.editEmployee', { name: 'E001' }) }),
    ).toBeInTheDocument();
  });

  it('shows the backend message on 409 EMPLOYEE_CODE_TAKEN', async () => {
    signIn(['org:read', 'org:manage']);
    vi.mocked(api.post).mockRejectedValue(
      apiError(409, {
        statusCode: 409,
        code: 'EMPLOYEE_CODE_TAKEN',
        message: 'รหัสพนักงานนี้ถูกใช้แล้ว',
        correlationId: 'c',
      }),
    );
    renderWithProviders(<EmployeesPage />);
    await screen.findByText('E001');
    await userEvent.click(screen.getByRole('button', { name: t('employees.newButton') }));
    await userEvent.type(await screen.findByLabelText(t('employees.form.code')), 'E001');
    await userEvent.type(screen.getByLabelText(t('employees.form.firstName')), 'ก');
    await userEvent.type(screen.getByLabelText(t('employees.form.lastName')), 'ข');
    await userEvent.selectOptions(screen.getByLabelText(t('employees.form.department')), '3');
    await userEvent.click(screen.getByRole('button', { name: t('employees.form.create') }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/employees', {
        employeeCode: 'E001',
        firstName: 'ก',
        lastName: 'ข',
        departmentId: '3',
      }),
    );
    expect((await screen.findAllByText('รหัสพนักงานนี้ถูกใช้แล้ว')).length).toBeGreaterThan(0);
  });

  it('deletes after confirmation', async () => {
    signIn(['org:read', 'org:manage']);
    vi.mocked(api.delete).mockResolvedValue({ data: null });
    renderWithProviders(<EmployeesPage />);
    await screen.findByText('E001');
    await userEvent.click(
      screen.getByRole('button', { name: t('employees.moreActions', { name: 'E001' }) }),
    );
    await userEvent.click(
      await screen.findByRole('menuitem', {
        name: new RegExp(t('employees.deleteEmployee', { name: 'E001' })),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: t('common.delete') }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/employees/9'));
  });
});

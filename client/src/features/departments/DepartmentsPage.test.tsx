import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranslationKey } from '@/i18n/locales/th';
import { translate } from '@/i18n/translate';
import { api } from '@/lib/apiClient';
import { apiError, renderWithProviders, signIn, signOut } from '@/test/renderPage';
import { DepartmentsPage } from './DepartmentsPage';
import type { DepartmentNode } from './departments.api';

vi.mock('@/lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const t = (key: TranslationKey, params?: Record<string, string | number>) =>
  translate('th', key, params);

const TREE: DepartmentNode[] = [
  {
    id: '1',
    code: 'HQ',
    name: 'สำนักงานใหญ่',
    parentId: null,
    isActive: true,
    children: [
      { id: '2', code: 'OPS', name: 'ปฏิบัติการ', parentId: '1', isActive: true, children: [] },
    ],
  },
  { id: '3', code: 'IT', name: 'ไอที', parentId: null, isActive: false, children: [] },
];

function mockTree(tree: DepartmentNode[] = TREE) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/departments/tree') return Promise.resolve({ data: { data: tree, total: 3 } });
    return Promise.reject(new Error(`unmocked GET ${url}`));
  });
}

async function openDelete(name: string) {
  await userEvent.click(
    screen.getByRole('button', { name: t('departments.moreActions', { name }) }),
  );
  await userEvent.click(
    await screen.findByRole('menuitem', {
      name: new RegExp(t('departments.deleteDepartment', { name })),
    }),
  );
  await userEvent.click(await screen.findByRole('button', { name: t('common.delete') }));
}

beforeEach(() => {
  for (const fn of [api.get, api.post, api.patch, api.put, api.delete]) vi.mocked(fn).mockReset();
  mockTree();
});
afterEach(signOut);

describe('DepartmentsPage', () => {
  it('renders the nested tree with active state text', async () => {
    signIn(['org:read']);
    renderWithProviders(<DepartmentsPage />);
    expect(await screen.findByText('สำนักงานใหญ่')).toBeInTheDocument();
    expect(screen.getByText('ปฏิบัติการ')).toBeInTheDocument();
    expect(screen.getByText(t('departments.status.inactive'))).toBeInTheDocument();
  });

  it('hides write tools without org:manage', async () => {
    signIn(['org:read']);
    renderWithProviders(<DepartmentsPage />);
    await screen.findByText('สำนักงานใหญ่');
    expect(screen.queryByRole('button', { name: t('departments.newButton') })).toBeNull();
    expect(
      screen.queryByRole('button', { name: t('departments.editDepartment', { name: 'ไอที' }) }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: t('departments.moreActions', { name: 'ไอที' }) }),
    ).toBeNull();
  });

  it('shows write tools with org:manage', async () => {
    signIn(['org:read', 'org:manage']);
    renderWithProviders(<DepartmentsPage />);
    await screen.findByText('สำนักงานใหญ่');
    expect(screen.getByRole('button', { name: t('departments.newButton') })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: t('departments.editDepartment', { name: 'ไอที' }) }),
    ).toBeInTheDocument();
  });

  it('empty state: its Add button is secondary (outline); the toolbar Add stays the one primary action', async () => {
    signIn(['org:read', 'org:manage']);
    mockTree([]);
    renderWithProviders(<DepartmentsPage />);

    const empty = await screen.findByRole('status', { name: t('departments.empty') });
    const emptyAdd = within(empty).getByRole('button', { name: t('departments.newButton') });
    expect(emptyAdd).toHaveClass('border-input');
    expect(emptyAdd).not.toHaveClass('bg-primary');
    const toolbar = screen.getByRole('toolbar', { name: t('departments.toolbar') });
    expect(within(toolbar).getByRole('button', { name: t('departments.newButton') })).toHaveClass(
      'bg-primary',
    );
  });

  it('distinguishes empty from filtered-empty', async () => {
    signIn(['org:read', 'org:manage']);
    mockTree([]);
    const { unmount } = renderWithProviders(<DepartmentsPage />);
    expect(await screen.findByText(t('departments.empty'))).toBeInTheDocument();
    unmount();

    mockTree();
    renderWithProviders(<DepartmentsPage />);
    await screen.findByText('สำนักงานใหญ่');
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(await screen.findByText(t('departments.filteredEmpty'))).toBeInTheDocument();
    expect(screen.queryByText(t('departments.empty'))).toBeNull();
  });

  it('blocks delete with a persistent Alert naming counts plus an error toast on 409 DEPARTMENT_IN_USE', async () => {
    signIn(['org:read', 'org:manage']);
    vi.mocked(api.delete).mockRejectedValue(
      apiError(409, {
        statusCode: 409,
        code: 'DEPARTMENT_IN_USE',
        message: 'ลบแผนกไม่ได้ เพราะยังมีข้อมูลที่เกี่ยวข้อง',
        details: { children: 1, employees: 3 },
        correlationId: 'c1',
      }),
    );
    renderWithProviders(<DepartmentsPage />);
    await screen.findByText('สำนักงานใหญ่');
    await openDelete('สำนักงานใหญ่');

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/departments/1'));
    expect(t('departments.inUse', { children: 1, employees: 3 })).toBe(
      'มีแผนกย่อย 1 แผนก และพนักงาน 3 คน',
    );
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('มีแผนกย่อย 1 แผนก และพนักงาน 3 คน')).toBeInTheDocument();
    expect(within(alert).getByText(t('departments.deleteFailed'))).toBeInTheDocument();
    // the error toast repeats the failure title outside the page Alert
    await waitFor(() =>
      expect(screen.getAllByText(t('departments.deleteFailed')).length).toBeGreaterThanOrEqual(2),
    );
  });

  it('removes a department and shows a success toast', async () => {
    signIn(['org:read', 'org:manage']);
    vi.mocked(api.delete).mockResolvedValue({ data: null });
    renderWithProviders(<DepartmentsPage />);
    await screen.findByText('ไอที');
    await openDelete('ไอที');
    expect(await screen.findByText(t('departments.deletedToast'))).toBeInTheDocument();
  });

  it('create dialog posts code and name', async () => {
    signIn(['org:read', 'org:manage']);
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    renderWithProviders(<DepartmentsPage />);
    await screen.findByText('สำนักงานใหญ่');
    await userEvent.click(screen.getByRole('button', { name: t('departments.newButton') }));
    await userEvent.type(await screen.findByLabelText(t('departments.form.code')), 'FIN');
    await userEvent.type(screen.getByLabelText(t('departments.form.name')), 'การเงิน');
    await userEvent.click(screen.getByRole('button', { name: t('departments.form.create') }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/departments', { code: 'FIN', name: 'การเงิน' }),
    );
  });

  it('parent picker excludes the edited department and its descendants', async () => {
    signIn(['org:read', 'org:manage']);
    renderWithProviders(<DepartmentsPage />);
    await screen.findByText('สำนักงานใหญ่');
    await userEvent.click(
      screen.getByRole('button', {
        name: t('departments.editDepartment', { name: 'สำนักงานใหญ่' }),
      }),
    );
    const select = await screen.findByLabelText(new RegExp(t('departments.form.parent')));
    const labels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toEqual([t('departments.form.noParent'), 'ไอที (IT)']);
  });
});

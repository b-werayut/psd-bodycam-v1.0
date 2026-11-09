import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranslationKey } from '@/i18n/locales/th';
import { translate } from '@/i18n/translate';
import { api } from '@/lib/apiClient';
import { PERMISSION_CATALOG } from '../permissionCatalog';
import { renderWithProviders, signIn, signOut } from '../testUtils';
import { RolePermissionsPanel } from './RolePermissionsPanel';

vi.mock('@/lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const t = (key: TranslationKey, params?: Record<string, string | number>) =>
  translate('th', key, params);

beforeEach(() => {
  signIn(['roles:manage']);
  vi.mocked(api.put).mockReset();
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/roles')
      return Promise.resolve({
        data: {
          data: [
            { id: '1', code: 'ADMIN', name: 'ผู้ดูแลระบบ', isSystem: true },
            { id: '2', code: 'OPERATOR', name: 'เจ้าหน้าที่', isSystem: true },
          ],
          total: 2,
        },
      });
    if (url === '/roles/2/permissions')
      return Promise.resolve({ data: { data: ['dashboard:view', 'users:read'], total: 2 } });
    return Promise.reject(new Error(`unmocked GET ${url}`));
  });
});
afterEach(signOut);

const cell = (code: string, role: string) =>
  screen.getByRole('checkbox', { name: t('users.roles.cell', { permission: code, role }) });

describe('RolePermissionsPanel', () => {
  it('lists all catalog permissions and locks the ADMIN column with a reason', async () => {
    renderWithProviders(<RolePermissionsPanel />);
    await screen.findByRole('checkbox', {
      name: t('users.roles.cell', { permission: 'dashboard:view', role: 'เจ้าหน้าที่' }),
    });

    expect(screen.getAllByRole('checkbox')).toHaveLength(PERMISSION_CATALOG.length * 2);
    for (const code of PERMISSION_CATALOG) {
      const admin = cell(code, 'ผู้ดูแลระบบ');
      expect(admin).toBeDisabled();
      expect(admin).toBeChecked();
    }
    expect(screen.getByText(t('users.roles.adminReadOnly'))).toBeInTheDocument();
    expect(cell('dashboard:view', 'เจ้าหน้าที่')).toBeChecked();
    expect(cell('audit:view', 'เจ้าหน้าที่')).not.toBeChecked();
  });

  it('saves the checked codes of the edited role', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: {} });
    renderWithProviders(<RolePermissionsPanel />);
    await screen.findByRole('checkbox', {
      name: t('users.roles.cell', { permission: 'dashboard:view', role: 'เจ้าหน้าที่' }),
    });

    const save = screen.getByRole('button', { name: t('users.roles.save') });
    expect(save).toBeDisabled();

    await userEvent.click(cell('audit:view', 'เจ้าหน้าที่'));
    await userEvent.click(cell('dashboard:view', 'เจ้าหน้าที่'));
    await userEvent.click(save);

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/roles/2/permissions', {
        permissions: ['users:read', 'audit:view'],
      }),
    );
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(t('users.roles.savedToast'))).toBeInTheDocument();
  });
});

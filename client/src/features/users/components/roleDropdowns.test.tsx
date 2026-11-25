import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/apiClient';
import { renderWithProviders, signIn, signOut } from '../testUtils';
import { UserFormDialog } from './UserFormDialog';
import { EntraBulkCreateDialog } from './EntraBulkCreateDialog';

vi.mock('@/lib/apiClient', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

beforeEach(() => {
  // Include SUPER_ADMIN even for ADMIN to exercise cached/stale-response protection in the UI.
  vi.mocked(api.get).mockResolvedValue({ data: { data: [
    { id: '1', code: 'SUPER_ADMIN', name: 'ผู้ดูแลระบบสูงสุด', isSystem: true },
    { id: '2', code: 'ADMIN', name: 'ผู้ดูแลระบบ', isSystem: true },
    { id: '3', code: 'OPERATOR', name: 'ผู้ปฏิบัติการ', isSystem: true },
  ], total: 3 } });
});
afterEach(signOut);

it.each([
  ['ADMIN', 'single', false], ['ADMIN', 'bulk', false],
  ['SUPER_ADMIN', 'single', true], ['SUPER_ADMIN', 'bulk', true],
] as const)('%s gets only assignable roles in the %s dropdown', async (roleCode, form, allowSuperAdmin) => {
  signIn(['users:manage'], { roleCode });
  renderWithProviders(form === 'single'
    ? <UserFormDialog onClose={vi.fn()} />
    : <EntraBulkCreateDialog rows={[]} onClose={vi.fn()} />);
  const select = screen.getByRole('combobox');
  await waitFor(() => expect(within(select).getByRole('option', { name: 'ผู้ปฏิบัติการ' })).toBeInTheDocument());
  const codes = within(select).getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
  expect(codes.includes('SUPER_ADMIN')).toBe(allowSuperAdmin);
  expect(codes).toContain('ADMIN');
});

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranslationKey } from '@/i18n/locales/th';
import { translate } from '@/i18n/translate';
import { api } from '@/lib/apiClient';
import { apiError, renderWithProviders, signIn, signOut } from '@/test/renderPage';
import { SettingsPage } from './SettingsPage';

vi.mock('@/lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const t = (key: TranslationKey, params?: Record<string, string | number>) =>
  translate('th', key, params);

const BOOL_ITEM = {
  key: 'matching.auto-link',
  value: 'false',
  valueType: 3,
  description: 'จับคู่ใบงานอัตโนมัติ',
};

const SETTINGS = {
  groups: [
    {
      category: 'auth',
      items: [
        {
          key: 'auth.max-failed-logins',
          value: '5',
          valueType: 2,
          description: 'จำนวนครั้งที่ล็อกอินผิดได้',
          min: 3,
          max: 20,
        },
        {
          key: 'auth.lockout-minutes',
          value: '15',
          valueType: 2,
          description: 'ระยะเวลาล็อกบัญชี (นาที)',
          min: 1,
          max: 1440,
        },
      ],
    },
    {
      category: 'matching',
      items: [
        { key: 'matching.x', value: 'abc', valueType: 1, description: 'ตัวอย่าง' },
        BOOL_ITEM,
      ],
    },
  ],
  total: 4,
};

beforeEach(() => {
  for (const fn of [api.get, api.post, api.patch, api.put, api.delete]) vi.mocked(fn).mockReset();
  vi.mocked(api.get).mockResolvedValue({ data: SETTINGS });
  signIn(['settings:manage']);
});
afterEach(signOut);

const input = (key: string) => screen.getByLabelText(t('settings.valueOf', { key }));
const saveBtn = (key: string) => screen.getByRole('button', { name: t('settings.save', { key }) });
const authPanel = () => screen.findByRole('region', { name: t('settings.category.auth') });
const matchingPanel = () => screen.findByRole('region', { name: 'matching' });
const toggle = (key: string) =>
  screen.getByRole('checkbox', { name: t('settings.toggle', { key }) });

describe('SettingsPage', () => {
  it('groups settings by category, with raw code for unknown categories', async () => {
    renderWithProviders(<SettingsPage />);
    expect(await authPanel()).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'matching' })).toBeInTheDocument();
    expect(input('auth.max-failed-logins')).toHaveValue('5');
    expect(api.get).toHaveBeenCalledWith('/settings');
  });

  it('shows an inline error and disables save with the reason when out of range', async () => {
    renderWithProviders(<SettingsPage />);
    await authPanel();
    const field = input('auth.max-failed-logins');
    await userEvent.clear(field);
    await userEvent.type(field, '2');

    const reason = t('settings.error.min', { min: 3, max: 20 });
    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    const save = saveBtn('auth.max-failed-logins');
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription(new RegExp(reason));
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('saves a valid value with PATCH and shows a success toast', async () => {
    vi.mocked(api.patch).mockResolvedValue({
      data: { ...SETTINGS.groups[0].items[0], value: '8' },
    });
    renderWithProviders(<SettingsPage />);
    await authPanel();
    const field = input('auth.max-failed-logins');
    await userEvent.clear(field);
    await userEvent.type(field, '8');
    await userEvent.click(saveBtn('auth.max-failed-logins'));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/auth.max-failed-logins', { value: '8' }),
    );
    expect(await screen.findByText(t('settings.savedToast'))).toBeInTheDocument();
  });

  it('shows the server SETTING_OUT_OF_RANGE message inline', async () => {
    const message = 'ค่าต้องอยู่ระหว่าง 3 ถึง 20';
    vi.mocked(api.patch).mockRejectedValue(
      apiError(400, { statusCode: 400, code: 'SETTING_OUT_OF_RANGE', message }),
    );
    renderWithProviders(<SettingsPage />);
    const panel = await authPanel();
    const field = input('auth.max-failed-logins');
    await userEvent.clear(field);
    await userEvent.type(field, '9');
    await userEvent.click(saveBtn('auth.max-failed-logins'));

    expect(await within(panel).findByRole('alert')).toHaveTextContent(message);
  });

  it('bool: toggling saves "true" with PATCH and shows a success toast', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { ...BOOL_ITEM, value: 'true' } });
    renderWithProviders(<SettingsPage />);
    await matchingPanel();
    expect(toggle('matching.auto-link')).not.toBeChecked();

    await userEvent.click(toggle('matching.auto-link'));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/matching.auto-link', { value: 'true' }),
    );
    expect(await screen.findByText(t('settings.savedToast'))).toBeInTheDocument();
    expect(toggle('matching.auto-link')).toBeChecked();
  });

  it('bool: a failed save reverts the checkbox to the server value, with toast + inline alert', async () => {
    const message = 'บันทึกค่าไม่ได้ในขณะนี้';
    vi.mocked(api.patch).mockRejectedValue(
      apiError(409, { statusCode: 409, code: 'SETTING_LOCKED', message }),
    );
    renderWithProviders(<SettingsPage />);
    const panel = await matchingPanel();

    await userEvent.click(toggle('matching.auto-link'));

    expect(await within(panel).findByRole('alert')).toHaveTextContent(message);
    // sonner keeps earlier tests' active toasts in module state, so there may be more than one
    expect((await screen.findAllByText(t('settings.saveFailed'))).length).toBeGreaterThan(0);
    expect(toggle('matching.auto-link')).not.toBeChecked();
    expect(within(panel).getByText(t('settings.disabled'))).toBeInTheDocument();
  });

  it('shows a load error with retry', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(apiError(500, { message: 'x' }));
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByText(t('common.loadFailed'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }));
    expect(await authPanel()).toBeInTheDocument();
  });
});

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranslationKey } from '@/i18n/locales/th';
import { translate } from '@/i18n/translate';
import { api } from '@/lib/apiClient';
import { renderWithProviders, signIn, signOut } from '@/test/renderPage';
import { AuditLogsPage } from './AuditLogsPage';
import type { AuditRow } from './audit.api';

vi.mock('@/lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const t = (key: TranslationKey, params?: Record<string, string | number>) =>
  translate('th', key, params);

const row = (over: Partial<AuditRow>): AuditRow => ({
  id: '1',
  occurredAt: '2026-10-01T03:00:00.000Z',
  userId: '5',
  actorUsername: 'somchai',
  actorRole: 'ADMIN',
  action: 'CREATE_USER',
  resourceType: 'users',
  resourceId: '9',
  result: 1,
  httpMethod: 'POST',
  requestPath: '/api/users',
  ip: '10.0.0.5',
  correlationId: 'corr-ok-1',
  ...over,
});

const FAILED = row({
  id: '2',
  result: 2,
  action: 'ACCESS_DENIED',
  actorUsername: null,
  actorRole: null,
  resourceType: null,
  resourceId: null,
  ip: '10.0.0.9',
  correlationId: 'corr-fail-2',
});

function mockGets(rows: AuditRow[] = [row({}), FAILED], total = rows.length) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/audit-logs')
      return Promise.resolve({ data: { data: rows, page: 1, pageSize: 50, total } });
    if (url === '/audit-logs/actions')
      return Promise.resolve({ data: { data: ['ACCESS_DENIED', 'CREATE_USER'], total: 2 } });
    return Promise.reject(new Error(`unmocked GET ${url}`));
  });
}

const listCalls = () => vi.mocked(api.get).mock.calls.filter(([url]) => url === '/audit-logs');
const lastParams = () => listCalls()[listCalls().length - 1][1]!.params as Record<string, unknown>;

beforeEach(() => {
  for (const fn of [api.get, api.post, api.patch, api.put, api.delete]) vi.mocked(fn).mockReset();
  mockGets();
  signIn(['audit:view']);
});
afterEach(() => {
  signOut();
  vi.useRealTimers();
});

describe('AuditLogsPage', () => {
  it('renders rows and requests page 1 with no filters', async () => {
    renderWithProviders(<AuditLogsPage />);
    expect(await screen.findByText('10.0.0.5')).toBeInTheDocument();
    expect(screen.getByText('somchai')).toBeInTheDocument();
    expect(screen.getByText('users #9')).toBeInTheDocument();
    expect(lastParams()).toEqual({ page: 1, pageSize: 50 });
  });

  it('shows failed rows as a destructive badge with the text ไม่สำเร็จ', async () => {
    renderWithProviders(<AuditLogsPage />);
    await screen.findByText('10.0.0.9');
    const badge = within(screen.getByRole('table')).getByText('ไม่สำเร็จ').closest('[data-tone]');
    expect(badge).toHaveAttribute('data-tone', 'destructive');
    expect(within(screen.getByRole('table')).getByText('สำเร็จ').closest('[data-tone]')).toHaveAttribute('data-tone', 'success');
  });

  it('maps the result filter to a numeric query param', async () => {
    renderWithProviders(<AuditLogsPage />);
    await screen.findByText('10.0.0.5');
    await userEvent.selectOptions(screen.getByLabelText(t('audit.filter.result')), '2');
    await waitFor(() => expect(lastParams()).toEqual({ page: 1, pageSize: 50, result: 2 }));
  });

  it('maps the action filter to a query param, options from the server', async () => {
    renderWithProviders(<AuditLogsPage />);
    await screen.findByText('10.0.0.5');
    const box = screen.getByLabelText(t('audit.filter.action'));
    fireEvent.focus(box);
    const listbox = document.getElementById(box.getAttribute('aria-controls') ?? '') as HTMLElement;
    const options = within(listbox).getAllByRole('option');
    expect(options.map((o) => o.textContent?.trim())).toEqual(['ACCESS_DENIED', 'CREATE_USER']);
    fireEvent.click(options[1]);
    await waitFor(() => expect(lastParams().action).toBe('CREATE_USER'));
  });

  it('maps the date range to from/to ISO params: start and end of the Bangkok day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T08:00:00.000Z'));
    renderWithProviders(<AuditLogsPage />);
    await screen.findByText('10.0.0.5');

    fireEvent.click(screen.getByRole('button', { name: t('common.dateRange.label') }));
    const calendar = screen.getByRole('dialog', { name: t('common.dateRange.label') });
    fireEvent.click(within(calendar).getByRole('button', { name: /^วัน.+ที่ 1 ตุลาคม 2026$/ }));
    fireEvent.click(within(calendar).getByRole('button', { name: /^วัน.+ที่ 6 ตุลาคม 2026$/ }));

    // Asia/Bangkok = UTC+7 whatever the machine's zone: 1 Oct 00:00 → 30 Sep 17:00Z
    await waitFor(() =>
      expect(lastParams()).toMatchObject({
        from: '2026-09-30T17:00:00.000Z',
        to: '2026-10-06T16:59:59.999Z',
      }),
    );
  });

  it('shows occurredAt in Bangkok time', async () => {
    mockGets([row({ occurredAt: '2026-11-04T17:30:05.000Z' })]);
    renderWithProviders(<AuditLogsPage />);
    expect(await screen.findByText('5/11/69 00:30:05')).toBeInTheDocument();
  });

  it('sends the debounced search term', async () => {
    renderWithProviders(<AuditLogsPage />);
    await screen.findByText('10.0.0.5');
    await userEvent.type(screen.getByLabelText(t('audit.search')), 'admin');
    await waitFor(() => expect(lastParams().search).toBe('admin'));
  });

  it('shows filtered-empty when a filter yields no rows', async () => {
    renderWithProviders(<AuditLogsPage />);
    await screen.findByText('10.0.0.5');
    mockGets([]);
    await userEvent.selectOptions(screen.getByLabelText(t('audit.filter.result')), '2');
    expect(await screen.findByText(t('audit.filteredEmpty'))).toBeInTheDocument();
  });

  it('shows the correlation id and copies it with a success toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWithProviders(<AuditLogsPage />);
    expect(await screen.findByText('corr-fail-2')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: t('audit.copyCorrelation', { id: 'corr-fail-2' }) }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('corr-fail-2'));
    expect(await screen.findByText(t('audit.copiedToast'))).toBeInTheDocument();
  });

  it('shows a copy-failed toast when the clipboard rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWithProviders(<AuditLogsPage />);
    await screen.findByText('corr-ok-1');
    fireEvent.click(
      screen.getByRole('button', { name: t('audit.copyCorrelation', { id: 'corr-ok-1' }) }),
    );
    expect(await screen.findByText(t('audit.copyFailedToast'))).toBeInTheDocument();
  });
});

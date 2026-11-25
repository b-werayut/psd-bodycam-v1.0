import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiError, renderWithProviders, signIn, signOut } from '@/test/renderPage';
import { WorkOrdersPage } from './WorkOrdersPage';
import { workOrdersApi, type WorkOrderRow } from './workOrders.api';

const live = vi.hoisted(() => ({ listeners: new Set<() => void>() }));
vi.mock('@/providers/RealtimeProvider', () => ({
  useRealtime: () => ({
    connected: true,
    subscribe: (_event: string, listener: () => void) => {
      live.listeners.add(listener);
      return () => live.listeners.delete(listener);
    },
  }),
}));
// counts player unmounts: a list refresh must not tear the live view (and its talk call) down and rebuild it
const player = vi.hoisted(() => ({ unmounts: 0 }));
vi.mock('@/features/streaming/components/StreamPlayer', () => ({
  StreamPlayer: ({ device }: { device: { deviceCode: string } }) => {
    useEffect(() => () => { player.unmounts += 1; }, []);
    return <div data-testid="player">{device.deviceCode}</div>;
  },
}));
vi.mock('./workOrders.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workOrders.api')>();
  return { ...actual, workOrdersApi: { list: vi.fn(), detail: vi.fn(), events: vi.fn() } };
});

const row = (over: Partial<WorkOrderRow> = {}): WorkOrderRow => ({
  id: '11',
  workOrderNo: 'WO-0011',
  title: 'ส่งของลาดพร้าว',
  status: 1,
  needsReview: false,
  team: { id: '3', code: 'T3', name: 'ทีม 3' },
  leader: { id: '4', name: 'สมชาย ใจดี' },
  booking: {
    id: '21',
    externalJobNo: 'BK-77',
    doNo: 'DO-1',
    shNo: 'SH-1',
    plannedStartAt: '2026-11-25T01:00:00.000Z',
    plannedEndAt: null,
    siteName: 'ลาดพร้าว',
    detail: false,
  },
  workWindow: { from: '2026-11-25T02:00:00.000Z', to: null },
  openedAt: '2026-11-25T02:00:00.000Z',
  closedAt: null,
  lastActivityAt: null,
  cameras: [
    {
      deviceRef: 'CAM-A',
      deviceId: '1',
      deviceCode: 'SIM-0001',
      name: null,
      platformState: 'online',
      platformStatusFetchedAt: '2026-11-25T02:30:00.000Z',
      fromSession: false,
    },
    {
      deviceRef: 'CAM-X',
      deviceId: null,
      deviceCode: null,
      name: null,
      platformState: 'unknown',
      platformStatusFetchedAt: null,
      fromSession: false,
    },
  ],
  rowVersion: 1,
  ...over,
});

const list = vi.mocked(workOrdersApi.list);
const Where = () => {
  const l = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="where">{l.pathname + l.search}</div>
      <button type="button" onClick={() => navigate('/work-orders?status=1')}>
        go-open
      </button>
      <button type="button" onClick={() => navigate('/work-orders')}>
        go-menu
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        go-back
      </button>
    </>
  );
};
const renderPage = (url: string | string[] = '/work-orders') =>
  renderWithProviders(
    <MemoryRouter
      initialEntries={Array.isArray(url) ? url : [url]}
      initialIndex={Array.isArray(url) ? url.length - 1 : 0}
    >
      <Routes>
        <Route
          path="/work-orders"
          element={
            <>
              <WorkOrdersPage />
              <Where />
            </>
          }
        />
        <Route path="/work-orders/:id" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  player.unmounts = 0;
  list.mockReset();
  list.mockResolvedValue({ data: [row()], page: 1, pageSize: 20, total: 1 });
  vi.mocked(workOrdersApi.detail).mockReset();
  vi.mocked(workOrdersApi.detail).mockResolvedValue({
    ...row(), closeReason: null, reviewReasons: [], note: null, availableActions: [],
  });
  vi.mocked(workOrdersApi.events).mockReset();
  vi.mocked(workOrdersApi.events).mockResolvedValue([]);
  live.listeners.clear();
  signIn(['work-orders:read']);
});
afterEach(() => signOut());

describe('WorkOrdersPage', () => {
  it('renders rows with WO no, DO/SH, window text, team, cameras with state', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('WO-0011')).toBeInTheDocument();
    expect(within(table).getByText(/DO-1/)).toBeInTheDocument();
    expect(within(table).getByText(/SH-1/)).toBeInTheDocument();
    expect(within(table).getByText(/ปฏิบัติงานจริง/)).toBeInTheDocument();
    expect(within(table).getByText(/ตอนนี้/)).toBeInTheDocument();
    expect(within(table).getByText('ทีม 3')).toBeInTheDocument();
    expect(within(table).getByText('SIM-0001')).toBeInTheDocument();
    expect(within(table).getByText('กำลังดำเนินการ')).toBeInTheDocument();
    expect(screen.getByText(/อัปเดตสถานะกล้อง/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it('a cancelled order that never checked in shows the plan, not รอเริ่ม', async () => {
    list.mockResolvedValue({
      data: [row({ status: 3, workWindow: null, openedAt: null })],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('ยกเลิก')).toBeInTheDocument();
    expect(within(table).getByText(/^แผน /)).toBeInTheDocument();
    expect(within(table).queryByText(/รอเริ่ม/)).not.toBeInTheDocument();
  });

  it('a closed order without times shows — in the time column, not รอเริ่ม', async () => {
    list.mockResolvedValue({
      data: [
        row({
          status: 2,
          workWindow: null,
          openedAt: null,
          booking: { ...row().booking, plannedStartAt: null },
        }),
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('ปิดแล้ว')).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '—' })).toBeInTheDocument();
    expect(within(table).queryByText(/รอเริ่ม/)).not.toBeInTheDocument();
  });

  it('the Planned tab sets ?status=6 and refetches', async () => {
    renderPage();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('tab', { name: 'รอเริ่ม' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('?status=6'));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ status: 6, page: 1, pageSize: 20 }));
  });

  it('typing a search sets ?q= after a pause', async () => {
    renderPage();
    await screen.findByRole('table');
    await userEvent.type(screen.getByRole('searchbox'), 'WO-9');
    expect(screen.getByTestId('where')).not.toHaveTextContent('q=');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('q=WO-9'));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ q: 'WO-9', page: 1, pageSize: 20 }));
  });

  it('a menu click to /work-orders after a search empties the box and the URL stays without q', async () => {
    renderPage();
    await screen.findByRole('table');
    await userEvent.type(screen.getByRole('searchbox'), 'abc');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('q=abc'));

    await userEvent.click(screen.getByRole('button', { name: 'go-menu' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    // longer than the 300 ms pause: the old text must not come back into the URL
    await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/work-orders$/);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
  });

  it('browser Back to another q puts that q in the box and keeps it in the URL', async () => {
    renderPage(['/work-orders?q=old', '/work-orders?q=new']);
    await screen.findByRole('table');
    expect(screen.getByRole('searchbox')).toHaveValue('new');

    await userEvent.click(screen.getByRole('button', { name: 'go-back' }));
    expect(screen.getByRole('searchbox')).toHaveValue('old');
    await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
    expect(screen.getByTestId('where')).toHaveTextContent('/work-orders?q=old');
    expect(screen.getByRole('searchbox')).toHaveValue('old');
  });

  it('opens details from the work-order number without leaving the list', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('WO-0011'));
    expect(await screen.findByRole('dialog', { name: 'ส่งของลาดพร้าว' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/work-orders$/);
  });

  it('an unknown camera shows ไม่พบในระบบ', async () => {
    renderPage();
    expect(await screen.findByText(/ไม่พบในระบบ/)).toBeInTheDocument();
    expect(screen.getByText(/CAM-X/)).toBeInTheDocument();
  });

  it('shows the filtered-empty state', async () => {
    list.mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 });
    renderPage('/work-orders?status=3');
    expect(await screen.findByText('ไม่พบใบงานที่ตรงกับเงื่อนไข')).toBeInTheDocument();
  });

  it('keeps non-action cells in the list', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('ทีม 3'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/work-orders$/);
  });

  it('opens the eye tool, preserves filters and restores focus after Escape', async () => {
    const user = userEvent.setup();
    list.mockResolvedValue({ data: [row()], page: 1, pageSize: 20, total: 40 });
    renderPage('/work-orders?status=1&q=BK');
    const view = await screen.findByRole('button', { name: 'ดูข้อมูลใบงาน WO-0011' });
    await user.click(screen.getByRole('button', { name: 'ไปหน้าถัดไปของรายการใบงาน' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ status: 1, q: 'BK', page: 2, pageSize: 20 }));
    expect(workOrdersApi.detail).not.toHaveBeenCalled();
    await user.click(view);
    const dialog = await screen.findByRole('dialog', { name: 'ส่งของลาดพร้าว' });
    expect(await within(dialog).findByRole('region', { name: 'ข้อมูลงาน' })).toBeInTheDocument();
    expect(within(dialog).getByText('WO-0011')).toBeInTheDocument();
    expect(workOrdersApi.detail).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where')).toHaveTextContent('/work-orders?status=1&q=BK');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(view).toHaveFocus();
    expect(screen.getByRole('searchbox')).toHaveValue('BK');
    expect(screen.getByRole('tab', { name: 'กำลังดำเนินการ' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByText(/หน้า 2\/2/)).toBeInTheDocument();
  });

  it('keeps a loading dialog labelled and closable', async () => {
    vi.mocked(workOrdersApi.detail).mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderPage();
    const view = await screen.findByRole('button', { name: 'ดูข้อมูลใบงาน WO-0011' });
    await user.click(view);
    const dialog = await screen.findByRole('dialog', { name: 'ส่งของลาดพร้าว' });
    expect(within(dialog).getByRole('heading', { name: 'ส่งของลาดพร้าว' })).toHaveFocus();
    expect(within(dialog).getByText('WO-0011')).toBeInTheDocument();
    expect(workOrdersApi.events).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'ปิด' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(view).toHaveFocus();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('can retry a failed detail inside the dialog and close a missing work order', async () => {
    vi.mocked(workOrdersApi.detail)
      .mockRejectedValueOnce(apiError(500, { code: 'INTERNAL_ERROR', message: 'x' }))
      .mockRejectedValueOnce(apiError(404, { code: 'NOT_FOUND', message: 'x' }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'ดูข้อมูลใบงาน WO-0011' }));
    const dialog = await screen.findByRole('dialog', { name: 'ส่งของลาดพร้าว' });
    await user.click(await within(dialog).findByRole('button', { name: 'ลองใหม่' }));
    expect(await within(dialog).findByText('ไม่พบใบงาน')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/work-orders$/);
  });

  it('the all tab clears ?status=', async () => {
    renderPage('/work-orders?status=6');
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('tab', { name: 'ทั้งหมด' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/work-orders$/));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 }));
  });

  it('a filter change from history (back/forward) starts at page 1', async () => {
    list.mockResolvedValue({ data: [row()], page: 1, pageSize: 20, total: 45 });
    renderPage('/work-orders?status=6');
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'ไปหน้าถัดไปของรายการใบงาน' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ status: 6, page: 2, pageSize: 20 }));
    await userEvent.click(screen.getByRole('button', { name: 'go-open' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ status: 1, page: 1, pageSize: 20 }));
  });

  it('steps back to the last page when a refresh shrinks the total', async () => {
    list.mockImplementation(async ({ page }) => ({ data: [row()], page, pageSize: 20, total: 25 }));
    renderPage();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'ไปหน้าถัดไปของรายการใบงาน' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 }));

    list.mockImplementation(async ({ page }) => ({
      data: page === 1 ? [row({ workOrderNo: 'WO-FIRST' })] : [],
      page,
      pageSize: 20,
      total: 15,
    }));
    act(() => live.listeners.forEach((l) => l()));
    expect(await screen.findByText('WO-FIRST', undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
  }, 10000);
});

// the live dialog (and its talk call) belongs to the page, not to a table row: a refetch must never hang it up
describe('WorkOrdersPage live dialog', () => {
  beforeEach(() => signIn(['work-orders:read', 'streaming:view-live']));

  it('stays open when a refetch drops the row it was opened from', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'ดูสด SIM-0001' }));
    expect(await screen.findByTestId('player')).toHaveTextContent('SIM-0001');

    list.mockResolvedValue({ data: [row({ id: '12', workOrderNo: 'WO-0012', cameras: [] })], page: 1, pageSize: 20, total: 1 });
    act(() => live.listeners.forEach((l) => l()));
    expect(await screen.findByText('WO-0012', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText('WO-0011')).not.toBeInTheDocument();
    expect(screen.getByTestId('player')).toHaveTextContent('SIM-0001');
    expect(player.unmounts).toBe(0);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('player')).not.toBeInTheDocument());
  }, 10000);

  it('stays open when the list is replaced by the empty state', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'ดูสด SIM-0001' }));
    expect(await screen.findByTestId('player')).toBeInTheDocument();

    list.mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 });
    act(() => live.listeners.forEach((l) => l()));
    await waitFor(() => expect(screen.queryByRole('table')).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByTestId('player')).toBeInTheDocument();
    expect(player.unmounts).toBe(0);
  }, 10000);
});

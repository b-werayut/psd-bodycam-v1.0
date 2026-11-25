import { focusManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiError, renderWithProviders, signIn, signOut } from '@/test/renderPage';
import { WorkOrderDetailPage } from './WorkOrderDetailPage';
import {
  workOrdersApi,
  type BookingFull,
  type WorkOrderDetail,
  type WorkOrderEvent,
} from './workOrders.api';

const live = vi.hoisted(() => ({ listeners: new Set<(payload: unknown) => void>() }));
vi.mock('@/providers/RealtimeProvider', () => ({
  useRealtime: () => ({
    connected: true,
    subscribe: (_event: string, listener: (payload: unknown) => void) => {
      live.listeners.add(listener);
      return () => live.listeners.delete(listener);
    },
  }),
}));
const pushChanged = (workOrderId: string) =>
  act(() => live.listeners.forEach((l) => l({ workOrderId, status: 1, needsReview: false, rowVersion: 2 })));
const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
vi.mock('./workOrders.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./workOrders.api')>();
  return { ...actual, workOrdersApi: { list: vi.fn(), detail: vi.fn(), events: vi.fn() } };
});
// counts player unmounts: a list refresh must not tear the live view (and its talk call) down and rebuild it
const player = vi.hoisted(() => ({ unmounts: 0 }));
vi.mock('@/features/streaming/components/StreamPlayer', () => ({
  StreamPlayer: ({ device }: { device: { deviceCode: string } }) => {
    useEffect(() => () => { player.unmounts += 1; }, []);
    return <div data-testid="player">{device.deviceCode}</div>;
  },
}));
vi.mock('./WorkOrderSiteMap',() => ({
  WorkOrderSiteMap: ({ point }: { point: [number, number] }) => <div data-testid="site-map">{point.join(', ')}</div>,
}));

const full: BookingFull = {
  id: '21',
  sourceSystem: 'smart-booking',
  externalJobId: 'EXT-9',
  externalJobNo: 'BK-77',
  doNo: 'DO-1',
  shNo: 'SH-1',
  status: 2,
  rawStatus: 'CHECKED_IN',
  plannedStartAt: '2026-11-25T01:00:00.000Z',
  plannedEndAt: '2026-11-25T05:00:00.000Z',
  scheduledDate: '2026-11-25',
  checkInAt: '2026-11-25T02:00:00.000Z',
  checkOutAt: null,
  deviceRefs: ['CAM-A'],
  site: { name: 'คลังลาดพร้าว', address: '1 ถนนลาดพร้าว', lat: null, lng: null },
  lastSyncedAt: '2026-11-25T03:00:00.000Z',
  detail: true,
};

const detail = (over: Partial<WorkOrderDetail> = {}): WorkOrderDetail => ({
  id: '11',
  workOrderNo: 'WO-0011',
  title: 'ส่งของลาดพร้าว',
  status: 1,
  needsReview: true,
  team: { id: '3', code: 'T3', name: 'ทีม 3' },
  leader: { id: '4', name: 'สมชาย ใจดี' },
  booking: full,
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
  ],
  rowVersion: 1,
  closeReason: null,
  reviewReasons: [1],
  note: null,
  availableActions: [],
  ...over,
});

const events: WorkOrderEvent[] = [
  { id: '1', eventType: 1, fromStatus: null, toStatus: 6, source: 2, actorUserId: null, trackingSessionId: null, reason: null, detail: null, occurredAt: '2026-11-25T01:00:00.000Z' },
  { id: '2', eventType: 2, fromStatus: 6, toStatus: 1, source: 2, actorUserId: null, trackingSessionId: null, reason: null, detail: null, occurredAt: '2026-11-25T02:00:00.000Z' },
];

const getDetail = vi.mocked(workOrdersApi.detail);
const getEvents = vi.mocked(workOrdersApi.events);

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter initialEntries={['/work-orders/11']}>
      <Routes>
        <Route path="/work-orders/:id" element={<WorkOrderDetailPage />} />
        <Route path="/work-orders" element={<div>list-page</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  player.unmounts = 0;
  getDetail.mockReset();
  getEvents.mockReset();
  getDetail.mockResolvedValue(detail());
  getEvents.mockResolvedValue(events);
  live.listeners.clear();
  signIn(['work-orders:read']);
});
afterEach(() => {
  focusManager.setFocused(undefined);
  signOut();
});

describe('WorkOrderDetailPage', () => {
  it('shows camera names together with their codes and connectivity in the detail', async () => {
    const camera = detail().cameras[0];
    getDetail.mockResolvedValue(detail({ cameras: [
      { ...camera, name: 'กล้องทีมลาดพร้าว' },
      { ...camera, deviceRef: 'CAM-B', deviceId: '2', deviceCode: 'SIM-0002', name: 'กล้องสำรอง', platformState: 'offline' },
    ] }));
    renderPage();
    const cameras = await screen.findByRole('region', { name: 'กล้องของใบงาน' });
    expect(within(cameras).getByText('กล้องทีมลาดพร้าว')).toBeInTheDocument();
    expect(within(cameras).getByText('SIM-0001')).toBeInTheDocument();
    expect(within(cameras).getByText('กล้องสำรอง')).toBeInTheDocument();
    expect(within(cameras).getByText('SIM-0002')).toBeInTheDocument();
    expect(within(cameras).getByText('ออนไลน์')).toBeInTheDocument();
    expect(within(cameras).getByText('ออฟไลน์')).toBeInTheDocument();
  });

  it('shows actual site coordinates, including zero, and never renders an invalid map', async () => {
    getDetail.mockResolvedValue(detail({ booking: { ...full, site: { ...full.site, lat: 0, lng: 0 } } }));
    const first = renderPage();
    expect(await screen.findByTestId('site-map')).toHaveTextContent('0, 0');
    expect(screen.getByText('0.000000, 0.000000')).toBeInTheDocument();
    first.unmount();
    getDetail.mockResolvedValue(detail({ booking: { ...full, site: { ...full.site, lat: 91, lng: 100 } } }));
    renderPage();
    expect(await screen.findByText('ยังไม่มีพิกัดสถานที่')).toBeInTheDocument();
    expect(screen.queryByTestId('site-map')).not.toBeInTheDocument();
  });

  it('shows header, the full job panel and cameras', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /WO-0011/ })).toBeInTheDocument();
    expect(screen.getAllByText('กำลังดำเนินการ').length).toBeGreaterThan(0);
    expect(screen.getByText('ควรตรวจสอบ')).toBeInTheDocument();
    expect(screen.getByText('ข้อมูลงานเปลี่ยนหลังปิดใบงาน')).toBeInTheDocument();
    const panel = screen.getByRole('region', { name: 'ข้อมูลงาน' });
    expect(within(panel).getByText('BK-77')).toBeInTheDocument();
    expect(within(panel).getByText('EXT-9')).toBeInTheDocument();
    expect(within(panel).getByText('DO-1')).toBeInTheDocument();
    expect(within(panel).getByText('SH-1')).toBeInTheDocument();
    expect(within(panel).getByText('CHECKED_IN')).toBeInTheDocument();
    expect(within(panel).getByText('คลังลาดพร้าว')).toBeInTheDocument();
    expect(within(panel).getByText('1 ถนนลาดพร้าว')).toBeInTheDocument();
    expect(within(panel).getByText(/ทีม 3/)).toBeInTheDocument();
    expect(within(panel).getByText(/สมชาย ใจดี/)).toBeInTheDocument();
    const cams = screen.getByRole('region', { name: 'กล้องของใบงาน' });
    expect(within(cams).getByText('SIM-0001')).toBeInTheDocument();
    expect(within(cams).getByText('ออนไลน์')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /กลับไปรายการใบงาน/ })).toHaveAttribute('href', '/work-orders');
  });

  it('without booking.detail only the summary is shown', async () => {
    getDetail.mockResolvedValue(
      detail({
        booking: {
          id: '21',
          externalJobNo: 'BK-77',
          doNo: 'DO-1',
          shNo: null,
          plannedStartAt: null,
          plannedEndAt: null,
          siteName: 'ลาดพร้าว',
          detail: false,
        },
      }),
    );
    renderPage();
    const panel = await screen.findByRole('region', { name: 'ข้อมูลงาน' });
    expect(within(panel).getByText('BK-77')).toBeInTheDocument();
    expect(within(panel).getByText('ลาดพร้าว')).toBeInTheDocument();
    expect(within(panel).queryByText('รหัสอ้างอิง Booking')).not.toBeInTheDocument();
    expect(within(panel).queryByText('CHECKED_IN')).not.toBeInTheDocument();
  });

  it('a cancelled order that never checked in shows the plan in the header, not รอเริ่ม', async () => {
    getDetail.mockResolvedValue(
      detail({ status: 3, workWindow: null, booking: { ...full, status: 5, checkInAt: null } }),
    );
    getEvents.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole('heading', { name: /WO-0011/ })).toBeInTheDocument();
    expect(screen.getByText('ยกเลิก')).toBeInTheDocument();
    expect(screen.getByText(/^แผน /)).toBeInTheDocument();
    expect(screen.queryByText(/รอเริ่ม/)).not.toBeInTheDocument();
  });

  it('a closed order without times shows — in the header, not รอเริ่ม', async () => {
    getDetail.mockResolvedValue(
      detail({
        status: 2,
        workWindow: null,
        booking: { ...full, status: 4, plannedStartAt: null, plannedEndAt: null, checkInAt: null },
      }),
    );
    getEvents.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole('heading', { name: /WO-0011/ })).toBeInTheDocument();
    expect(screen.getByText('ปิดแล้ว')).toBeInTheDocument();
    expect(screen.queryByText(/รอเริ่ม/)).not.toBeInTheDocument();
  });

  it('timeline lists created and status changes in order', async () => {
    renderPage();
    const items = await screen.findAllByRole('listitem', { name: /เหตุการณ์/ });
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('สร้างใบงาน');
    expect(items[1]).toHaveTextContent('สถานะเปลี่ยนจาก รอเริ่ม เป็น กำลังดำเนินการ');
    items.forEach((li) => expect(li).not.toHaveTextContent('Booking'));
  });

  // GET /work-orders/:id writes an audit row (VIEW_WORK_ORDER): refetch it only when this order changed
  it('a workorder:changed for another order does not refetch the detail; one for this order does', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /WO-0011/ })).toBeInTheDocument();
    await waitFor(() => expect(getEvents).toHaveBeenCalledTimes(1));
    expect(getDetail).toHaveBeenCalledTimes(1);

    pushChanged('12');
    await pause(1000); // past the 800 ms debounce
    expect(getDetail).toHaveBeenCalledTimes(1);
    expect(getEvents).toHaveBeenCalledTimes(1);

    pushChanged('11');
    await waitFor(() => expect(getDetail).toHaveBeenCalledTimes(2), { timeout: 3000 });
    await waitFor(() => expect(getEvents).toHaveBeenCalledTimes(2));
  }, 10000);

  it('returning to the window does not refetch the audited detail', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /WO-0011/ })).toBeInTheDocument();
    expect(getDetail).toHaveBeenCalledTimes(1);

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await pause(100);
    expect(getDetail).toHaveBeenCalledTimes(1);
  });

  describe('live dialog', () => {
    beforeEach(() => signIn(['work-orders:read', 'streaming:view-live']));

    it('stays open when the camera list empties on a refresh', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'ดูสด SIM-0001' }));
      expect(await screen.findByTestId('player')).toHaveTextContent('SIM-0001');

      getDetail.mockResolvedValue(detail({ cameras: [] }));
      pushChanged('11');
      expect(await screen.findByText('ยังไม่มีกล้อง', {}, { timeout: 3000 })).toBeInTheDocument();
      expect(screen.getByTestId('player')).toHaveTextContent('SIM-0001');
      expect(player.unmounts).toBe(0);
    }, 10000);

    it('stays open when the detail refresh fails', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'ดูสด SIM-0001' }));
      expect(await screen.findByTestId('player')).toBeInTheDocument();

      getDetail.mockRejectedValue(apiError(500, { code: 'INTERNAL_ERROR', message: 'x' }));
      pushChanged('11');
      expect(await screen.findByText('โหลดข้อมูลไม่สำเร็จ', {}, { timeout: 3000 })).toBeInTheDocument();
      expect(screen.getByTestId('player')).toBeInTheDocument();
      expect(player.unmounts).toBe(0);
    }, 10000);
  });

  it('404 shows ไม่พบใบงาน', async () => {
    getDetail.mockRejectedValue(apiError(404, { code: 'NOT_FOUND', message: 'x' }));
    renderPage();
    expect(await screen.findByText('ไม่พบใบงาน')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /กลับไปรายการใบงาน/ })).toHaveAttribute('href', '/work-orders');
  });
});

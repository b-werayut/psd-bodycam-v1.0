import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatDayMonth } from '@/lib/time';
import { workOrdersApi, type WorkOrderRow } from '@/features/work-orders/workOrders.api';
import { apiError, renderWithProviders, signIn, signOut } from '@/test/renderPage';
import { historyApi, type RouteHistory } from './history.api';
import { bangkokInstant, dayWindowOf, bangkokDateOf, shiftDay } from './historyRange';
import { HistoryPage } from './HistoryPage';

vi.mock('@/components/map/MapCanvas', () => ({
  MapCanvas: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
}));
vi.mock('./components/RouteLayers', () => ({
  RouteLayers: ({ route, focus }: { route: RouteHistory; focus: [number, number] | null }) => (
    <div data-testid="route" data-focus={JSON.stringify(focus)}>{route.segments.length} segments</div>
  ),
}));
vi.mock('./history.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./history.api')>();
  return { ...actual, historyApi: { devices: vi.fn(), history: vi.fn() } };
});
vi.mock('@/features/work-orders/workOrders.api', () => ({ workOrdersApi: { list: vi.fn() } }));

const route = (extra: Partial<RouteHistory> = {}): RouteHistory => ({
  device: { id: '1', code: 'SIM-0001', name: 'กล้องจำลอง 1' },
  from: '2026-11-22T17:00:00.000Z',
  to: '2026-11-23T17:00:00.000Z',
  rules: { stopRadiusM: 50, stopMinMinutes: 5, gapSeconds: 150 },
  pointCount: 41,
  suspectCount: 1,
  staleStartCount: 0,
  spikeCount: 0,
  smoothedCount: 0,
  truncated: false,
  start: { lat: 13.75, lng: 100.5, at: '2026-11-23T01:00:00.000Z' },
  end: { lat: 13.76, lng: 100.5, at: '2026-11-23T01:20:00.000Z' },
  totalDistanceM: 12_350,
  totalDistanceApprox: false,
  segments: [
    [
      [13.75, 100.5],
      [13.76, 100.5],
    ],
  ],
  gaps: [],
  timeline: [
    {
      kind: 'stop',
      index: 1,
      startAt: '2026-11-23T01:00:00.000Z',
      endAt: '2026-11-23T01:10:00.000Z',
      seconds: 600,
      lat: 13.75,
      lng: 100.5,
      noSignalSeconds: 0,
      distanceFromPrevM: 0,
      distanceFromPrevApprox: false,
    },
  ],
  ...extra,
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

const renderAt = (search = '', { viewSwitch = false } = {}) =>
  renderWithProviders(
    <MemoryRouter initialEntries={[`/tracking/history${search}`]}>
      <Routes>
        <Route
          path="/tracking/history"
          element={
            <>
              <HistoryPage viewSwitch={viewSwitch} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

const today = dayWindowOf(bangkokDateOf(new Date()));
const yesterday = dayWindowOf(shiftDay(bangkokDateOf(new Date()), -1));
const q = (w: { from: string; to: string }, deviceId = '1') =>
  `?deviceId=${deviceId}&from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`;

const todayYmd = bangkokDateOf(new Date());
const d1 = shiftDay(todayYmd, -1);
const d2 = shiftDay(todayYmd, -2);
/** last night 20:00 → this morning 06:00, Bangkok */
const night = { from: bangkokInstant(d1, '20:00')!, to: bangkokInstant(todayYmd, '06:00')! };
const setField = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const chooseCamera = async (user: ReturnType<typeof userEvent.setup>, code: string) => {
  const camera = screen.getByRole('combobox', { name: 'กล้อง' });
  await waitFor(() => expect(camera).toBeEnabled());
  await user.click(camera);
  await user.click(await screen.findByRole('option', { name: new RegExp(code) }));
};
const workOrder = (id: string, from: string, to: string, deviceId = '1'): WorkOrderRow => ({
  id, workOrderNo: `WO-${id}`, title: `ตรวจอาคาร ${id}`, status: 3, needsReview: false,
  team: null, leader: null,
  booking: { id, externalJobNo: null, doNo: null, shNo: null, plannedStartAt: null, plannedEndAt: null, siteName: null, detail: false },
  workWindow: { from, to }, openedAt: from, closedAt: to, lastActivityAt: to, rowVersion: 1,
  cameras: [{ deviceRef: deviceId, deviceId, deviceCode: `SIM-000${deviceId}`, name: null, platformState: 'unknown', platformStatusFetchedAt: null, fromSession: false }],
});

describe('HistoryPage', () => {
  beforeEach(() => {
    signIn(['tracking:history', 'devices:read']);
    vi.mocked(historyApi.devices).mockResolvedValue([
      { id: '1', deviceCode: 'SIM-0001', name: 'กล้องจำลอง 1' },
      { id: '2', deviceCode: 'SIM-0002', name: null },
    ]);
    vi.mocked(historyApi.history).mockResolvedValue(route());
    vi.mocked(workOrdersApi.list).mockResolvedValue({ data: [], page: 1, pageSize: 100, total: 0 });
  });
  afterEach(() => {
    signOut();
    vi.clearAllMocks();
  });

  it('asks for a camera and an explicit time range before loading the route', async () => {
    const user = userEvent.setup();
    renderAt();
    expect(screen.getByRole('heading', { name: 'ประวัติเส้นทาง' })).toBeInTheDocument();
    expect(screen.getByText('เลือกกล้องเพื่อดูเส้นทาง')).toBeInTheDocument();
    expect(historyApi.history).not.toHaveBeenCalled();

    await chooseCamera(user, 'SIM-0001');
    expect(screen.getByLabelText('เริ่มต้น')).toHaveValue('');
    expect(screen.getByLabelText('สิ้นสุด')).toHaveValue('');
    expect(historyApi.history).not.toHaveBeenCalled();
    setField('เริ่มต้น', `${todayYmd}T00:00`);
    setField('สิ้นสุด', `${shiftDay(todayYmd, 1)}T00:00`);
    await user.click(screen.getByRole('button', { name: 'ดูเส้นทาง' }));
    await waitFor(() => expect(historyApi.history).toHaveBeenCalledTimes(1));
    expect(historyApi.history).toHaveBeenCalledWith('1', today.from, today.to);
    expect(screen.getByTestId('location').textContent).toBe(q(today));
  });

  it('opened as a tab of แผนที่ติดตาม (?view=history), choosing the camera and range keeps that view', async () => {
    const user = userEvent.setup();
    renderAt('?view=history');
    await chooseCamera(user, 'SIM-0001');
    expect(historyApi.history).not.toHaveBeenCalled();
    setField('เริ่มต้น', `${todayYmd}T00:00`);
    setField('สิ้นสุด', `${shiftDay(todayYmd, 1)}T00:00`);
    await user.click(screen.getByRole('button', { name: 'ดูเส้นทาง' }));
    await waitFor(() => expect(historyApi.history).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('location').textContent).toBe(`${q(today)}&view=history`);
  });

  it('the ประวัติเส้นทาง menu has no view tabs, even for a user who may open both views', () => {
    signOut();
    signIn(['tracking:history', 'tracking:view', 'devices:read']);
    renderAt();
    expect(screen.queryByRole('navigation', { name: 'มุมมองแผนที่' })).not.toBeInTheDocument();
  });

  it('as the history tab of แผนที่ติดตาม it shows the tabs (only with tracking:view as well)', () => {
    renderAt('', { viewSwitch: true });
    expect(screen.queryByRole('navigation', { name: 'มุมมองแผนที่' })).not.toBeInTheDocument();
    signOut();
    signIn(['tracking:history', 'tracking:view', 'devices:read']);
    renderAt('', { viewSwitch: true });
    const tabs = screen.getAllByRole('navigation', { name: 'มุมมองแผนที่' })[0];
    expect(within(tabs).getByRole('link', { name: 'ประวัติเส้นทาง' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'ตำแหน่งปัจจุบัน' })).toHaveAttribute('href', '/tracking?view=live');
  });

  it('enables range controls only after selecting a camera and disables them again when cleared', async () => {
    const user = userEvent.setup();
    renderAt(q(yesterday, ''));
    const fields = ['เริ่มต้น', 'สิ้นสุด'].map((label) => screen.getByLabelText(label));
    const controls = [...fields, screen.getByRole('button', { name: 'ดูเส้นทาง' })];
    for (const control of controls) expect(control).toBeDisabled();
    expect(historyApi.history).not.toHaveBeenCalled();

    await chooseCamera(user, 'SIM-0001');
    for (const control of controls) expect(control).toBeEnabled();
    await waitFor(() => expect(historyApi.history).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'ล้างตัวเลือก' }));
    for (const control of controls) expect(control).toBeDisabled();
    expect(historyApi.history).toHaveBeenCalledTimes(1);
  });

  it('uses the datepicker range without a separate day selector and preserves the map history tab', async () => {
    const user = userEvent.setup();
    renderAt(`${q(today)}&view=history`);
    await screen.findByTestId('route');
    expect(screen.queryByRole('combobox', { name: 'วัน' })).not.toBeInTheDocument();
    setField('เริ่มต้น', `${d1}T00:00`);
    setField('สิ้นสุด', `${todayYmd}T00:00`);
    expect(historyApi.history).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'ดูเส้นทาง' }));
    await waitFor(() => expect(historyApi.history).toHaveBeenLastCalledWith('1', yesterday.from, yesterday.to));
    expect(screen.getByLabelText('เริ่มต้น')).toHaveValue(`${d1}T00:00`);
    expect(screen.getByTestId('location')).toHaveTextContent(`${q(yesterday)}&view=history`);
  });

  it('loads work orders only after both times are chosen, with the picker after the time range', async () => {
    const user = userEvent.setup();
    signIn(['tracking:history', 'devices:read', 'work-orders:read']);
    vi.mocked(workOrdersApi.list).mockResolvedValue({ data: [
      workOrder('MATCH', bangkokInstant(d1, '08:30')!, bangkokInstant(d1, '09:30')!),
      workOrder('OUTSIDE', bangkokInstant(d1, '10:00')!, bangkokInstant(d1, '11:00')!),
    ], page: 1, pageSize: 100, total: 2 });
    renderAt();
    const picker = screen.getByRole('combobox', { name: 'ใบงานของกล้อง' });
    expect(picker).toBeDisabled();
    await chooseCamera(user, 'SIM-0001');
    expect(picker).toBeDisabled();
    expect(picker).toHaveAttribute('placeholder', 'เลือกช่วงเวลาเริ่มต้น–สิ้นสุดก่อนค้นหาใบงาน');
    expect(workOrdersApi.list).not.toHaveBeenCalled();
    setField('เริ่มต้น', `${d1}T08:00`);
    expect(picker).toBeDisabled();
    expect(workOrdersApi.list).not.toHaveBeenCalled();
    setField('สิ้นสุด', `${d1}T09:00`);
    await waitFor(() => expect(picker).toBeEnabled());
    await user.click(screen.getByLabelText('สิ้นสุด'));
    await user.tab();
    expect(picker).toHaveFocus();
    expect(screen.getByRole('option', { name: /WO-MATCH/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /WO-OUTSIDE/ })).not.toBeInTheDocument();
    expect(workOrdersApi.list).toHaveBeenCalledTimes(1);
    expect(historyApi.history).not.toHaveBeenCalled();
  });

  it('clips a work order to the draft datepicker range across midnight, loading only on confirmation', async () => {
    const user = userEvent.setup();
    signIn(['tracking:history', 'devices:read', 'work-orders:read']);
    vi.mocked(workOrdersApi.list).mockResolvedValue({ data: [
      workOrder('001', bangkokInstant(d2, '23:00')!, bangkokInstant(d1, '06:00')!),
      workOrder('OTHER', bangkokInstant(d1, '08:00')!, bangkokInstant(d1, '09:00')!, '2'),
      workOrder('OLD', bangkokInstant(d2, '08:00')!, bangkokInstant(d2, '09:00')!),
    ], page: 1, pageSize: 100, total: 3 });
    renderAt(q(yesterday));
    await screen.findByTestId('route');
    setField('เริ่มต้น', `${d2}T23:30`);
    setField('สิ้นสุด', `${d1}T05:00`);
    const picker = screen.getByRole('combobox', { name: 'ใบงานของกล้อง' });
    await waitFor(() => expect(picker).toBeEnabled());
    await user.click(picker);
    expect(screen.queryByRole('option', { name: /WO-OTHER|WO-OLD/ })).not.toBeInTheDocument();
    await user.type(picker, 'ตรวจอาคาร');
    await user.click(await screen.findByRole('option', { name: /WO-001/ }));
    expect(workOrdersApi.list).toHaveBeenCalledWith({ deviceId: '1', page: 1, pageSize: 100 });
    expect(screen.getByLabelText('เริ่มต้น')).toHaveValue(`${d2}T23:30`);
    expect(screen.getByLabelText('สิ้นสุด')).toHaveValue(`${d1}T05:00`);
    expect(historyApi.history).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'ดูเส้นทาง' }));
    await waitFor(() => expect(historyApi.history).toHaveBeenLastCalledWith('1', bangkokInstant(d2, '23:30'), bangkokInstant(d1, '05:00')));
    expect(picker).toHaveValue('WO-001 · ตรวจอาคาร 001');
    await user.click(screen.getByRole('button', { name: 'ล้างใบงาน' }));
    expect(screen.getByLabelText('เริ่มต้น')).toHaveValue(`${d2}T23:30`);
    expect(screen.getByLabelText('สิ้นสุด')).toHaveValue(`${d1}T05:00`);
    expect(historyApi.history).toHaveBeenCalledTimes(2);
  });

  it('clears the selected work order and filters immediately when editing times or changing camera', async () => {
    const user = userEvent.setup();
    signIn(['tracking:history', 'devices:read', 'work-orders:read']);
    vi.mocked(workOrdersApi.list).mockResolvedValue({ data: [
      workOrder('001', bangkokInstant(d1, '08:00')!, bangkokInstant(d1, '09:00')!),
    ], page: 1, pageSize: 100, total: 1 });
    renderAt(q(yesterday));
    const picker = screen.getByRole('combobox', { name: 'ใบงานของกล้อง' });
    await waitFor(() => expect(picker).toBeEnabled());
    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: /WO-001/ }));
    setField('เริ่มต้น', `${d1}T10:00`);
    setField('สิ้นสุด', `${d1}T11:00`);
    expect(picker).toHaveValue('');
    await user.click(picker);
    expect(screen.queryByRole('option', { name: /WO-001/ })).not.toBeInTheDocument();
    expect(screen.getByText('ไม่พบใบงานที่ตรงกับคำค้นหาในช่วงเวลาที่เลือก')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    setField('เริ่มต้น', `${d1}T08:00`);
    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: /WO-001/ }));
    await chooseCamera(user, 'SIM-0002');
    await waitFor(() => expect(workOrdersApi.list).toHaveBeenLastCalledWith({ deviceId: '2', page: 1, pageSize: 100 }));
    expect(picker).toHaveValue('');
  });

  it('filters work orders using the unsubmitted overnight range and excludes touching boundaries', async () => {
    const user = userEvent.setup();
    signIn(['tracking:history', 'devices:read', 'work-orders:read']);
    vi.mocked(workOrdersApi.list).mockResolvedValue({ data: [
      workOrder('NIGHT', bangkokInstant(d2, '22:00')!, bangkokInstant(d1, '02:00')!),
      workOrder('BEFORE', bangkokInstant(d2, '18:00')!, bangkokInstant(d2, '23:00')!),
      workOrder('AFTER', bangkokInstant(d1, '05:00')!, bangkokInstant(d1, '06:00')!),
    ], page: 1, pageSize: 100, total: 3 });
    renderAt(q(yesterday));
    await screen.findByTestId('route');
    const picker = screen.getByRole('combobox', { name: 'ใบงานของกล้อง' });
    await waitFor(() => expect(picker).toBeEnabled());
    setField('เริ่มต้น', `${d2}T23:00`);
    setField('สิ้นสุด', `${d1}T05:00`);
    await user.click(picker);
    expect(screen.getByRole('option', { name: /WO-NIGHT/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /WO-BEFORE|WO-AFTER/ })).not.toBeInTheDocument();
    expect(workOrdersApi.list).toHaveBeenCalledTimes(1);
    expect(historyApi.history).toHaveBeenCalledTimes(1);
  });

  it('disables work-order selection until the datepicker range is valid', async () => {
    signIn(['tracking:history', 'devices:read', 'work-orders:read']);
    renderAt(q(yesterday));
    const picker = screen.getByRole('combobox', { name: 'ใบงานของกล้อง' });
    await waitFor(() => expect(picker).toBeEnabled());
    setField('เริ่มต้น', '');
    expect(picker).toBeDisabled();
    setField('เริ่มต้น', `${todayYmd}T01:00`);
    expect(picker).toBeDisabled();
    setField('เริ่มต้น', `${d1}T00:00`);
    expect(picker).toBeEnabled();
  });

  it('does not request work orders without permission', async () => {
    renderAt(q(yesterday));
    await screen.findByTestId('route');
    expect(screen.getByRole('combobox', { name: 'ใบงานของกล้อง' })).toBeDisabled();
    expect(workOrdersApi.list).not.toHaveBeenCalled();
  });

  it('can retry work orders without fetching the route again', async () => {
    const user = userEvent.setup();
    signIn(['tracking:history', 'devices:read', 'work-orders:read']);
    vi.mocked(workOrdersApi.list).mockRejectedValueOnce(new Error('unavailable'));
    renderAt(q(yesterday));
    await user.click(await screen.findByRole('button', { name: 'ลองโหลดใบงานอีกครั้ง' }));
    await waitFor(() => expect(workOrdersApi.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('โหลดใบงานของกล้องไม่สำเร็จ')).not.toBeInTheDocument();
    expect(historyApi.history).toHaveBeenCalledTimes(1);
  });

  it('shows the summary, the route and the timeline of the chosen day', async () => {
    renderAt(q(today));
    expect(await screen.findByTestId('route')).toHaveTextContent('1 segments');
    expect(within(screen.getByRole('complementary')).getByText('จุดแวะ 1 แห่ง')).toBeInTheDocument();
    expect(screen.queryByText(/41 จุด/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /จุดแวะที่ 1/ })).toBeInTheDocument();
    expect(screen.getByText(/^ระยะทางรวม 12\.4\sกม\.$/)).toBeInTheDocument();
    expect(screen.queryByText('ช่วงไม่มีสัญญาณนับเป็นระยะเส้นตรง')).not.toBeInTheDocument();
    expect(historyApi.history).toHaveBeenCalledTimes(1);
  });

  it('opens the mobile route panel and closes it when focusing a timeline stop', async () => {
    const user = userEvent.setup();
    renderAt(q(today));
    await screen.findByTestId('route');
    await user.click(screen.getByRole('button', { name: 'ตัวเลือกและลำดับเส้นทาง' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('เริ่มต้น')).toHaveValue(`${todayYmd}T00:00`);
    await user.click(within(dialog).getByRole('button', { name: /จุดแวะที่ 1/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('route')).toHaveAttribute('data-focus', '[13.75,100.5]');
    expect(historyApi.history).toHaveBeenCalledTimes(1);
  });

  it('a total that crosses a no-signal stretch is marked approximate', async () => {
    vi.mocked(historyApi.history).mockResolvedValueOnce(route({ totalDistanceApprox: true }));
    renderAt(q(today));
    expect(await screen.findByText(/^ระยะทางรวม ≈ 12\.4\sกม\.$/)).toBeInTheDocument();
    expect(screen.queryByText('ช่วงไม่มีสัญญาณนับเป็นระยะเส้นตรง')).not.toBeInTheDocument();
    expect(screen.queryByText(/ไม่นำจุดผิดปกติ/)).not.toBeInTheDocument();
  });

  it('editing the fields does not load; Show route loads the Bangkok window', async () => {
    const user = userEvent.setup();
    renderAt(q(today));
    await screen.findByTestId('route');
    setField('เริ่มต้น', `${d2}T20:00`);
    setField('สิ้นสุด', `${d1}T06:00`);
    expect(historyApi.history).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'ดูเส้นทาง' }));
    await waitFor(() => expect(historyApi.history).toHaveBeenCalledTimes(2));
    expect(historyApi.history).toHaveBeenLastCalledWith('1', bangkokInstant(d2, '20:00'), bangkokInstant(d1, '06:00'));
  });

  it('a combined date and time range preserves seconds when loading the route', async () => {
    const user = userEvent.setup();
    renderAt(q(yesterday));
    await screen.findByTestId('route');
    setField('เริ่มต้น', `${d2}T20:00:15`);
    setField('สิ้นสุด', `${d1}T06:00:45`);
    expect(historyApi.history).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'ดูเส้นทาง' }));
    await waitFor(() => expect(historyApi.history).toHaveBeenCalledTimes(2));
    expect(historyApi.history).toHaveBeenLastCalledWith('1', `${d2}T13:00:15.000Z`, `${d2}T23:00:45.000Z`);
    expect(screen.getByLabelText('เริ่มต้น')).toHaveValue(`${d2}T20:00:15.000`);
    expect(screen.getByLabelText('สิ้นสุด')).toHaveValue(`${d1}T06:00:45.000`);
  });

  it('a range over 36 h, a reversed range or an empty date and time cannot be shown', async () => {
    renderAt(q(today));
    await screen.findByTestId('route');
    const show = screen.getByRole('button', { name: 'ดูเส้นทาง' });

    setField('เริ่มต้น', `${d2}T00:00`);
    setField('สิ้นสุด', `${d1}T13:00`);
    expect(show).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('ช่วงเวลาต้องไม่เกิน 36 ชั่วโมง');

    setField('เริ่มต้น', `${d2}T20:00`);
    setField('สิ้นสุด', `${d2}T06:00`);
    expect(show).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('เวลาสิ้นสุดต้องหลังเวลาเริ่ม');

    setField('เริ่มต้น', '');
    expect(show).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('กรอกวันและเวลาให้ครบ');
  });

  it('the loaded range is named under the fields', async () => {
    renderAt(q(night));
    await screen.findByTestId('route');
    const from = `${formatDayMonth(night.from, 'th')} 20:00`;
    const to = `${formatDayMonth(night.to, 'th')} 06:00`;
    expect(screen.getByText(`ช่วงที่แสดง ${from} – ${to}`)).toBeInTheDocument();
  });

  it('an edited range that is not loaded yet says so until Show route', async () => {
    const user = userEvent.setup();
    // A completed day keeps 08:00 in the past even when the suite runs before 08:00 Bangkok time.
    renderAt(q(yesterday));
    await screen.findByTestId('route');
    expect(screen.queryByText('ช่วงในช่องยังไม่ได้โหลด — กด ดูเส้นทาง')).not.toBeInTheDocument();

    setField('เริ่มต้น', `${d1}T08:00`);
    expect(screen.getByText('ช่วงในช่องยังไม่ได้โหลด — กด ดูเส้นทาง')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ดูเส้นทาง' }));
    await waitFor(() => expect(screen.queryByText('ช่วงในช่องยังไม่ได้โหลด — กด ดูเส้นทาง')).not.toBeInTheDocument());
  });

  it('Show route on the range already loaded loads it again (retry / refresh)', async () => {
    const user = userEvent.setup();
    renderAt(q(today));
    await screen.findByTestId('route');
    await user.click(screen.getByRole('button', { name: 'ดูเส้นทาง' }));
    await waitFor(() => expect(historyApi.history).toHaveBeenCalledTimes(2));
    expect(historyApi.history).toHaveBeenLastCalledWith('1', today.from, today.to);
  });

  it('changing camera loads the edited range when it is valid', async () => {
    const user = userEvent.setup();
    renderAt(q(today));
    await screen.findByTestId('route');
    setField('เริ่มต้น', `${d2}T20:00`);
    setField('สิ้นสุด', `${d1}T06:00`);
    await chooseCamera(user, 'SIM-0002');
    await waitFor(() =>
      expect(historyApi.history).toHaveBeenLastCalledWith('2', bangkokInstant(d2, '20:00'), bangkokInstant(d1, '06:00')),
    );
    expect(historyApi.history).toHaveBeenCalledTimes(2);
  });

  it('changing camera with an invalid edited range loads the loaded range and resets the fields', async () => {
    const user = userEvent.setup();
    renderAt(q(today));
    await screen.findByTestId('route');
    setField('เริ่มต้น', '');
    await chooseCamera(user, 'SIM-0002');
    await waitFor(() => expect(historyApi.history).toHaveBeenLastCalledWith('2', today.from, today.to));
    expect(screen.getByLabelText('เริ่มต้น')).toHaveValue(`${todayYmd}T00:00`);
  });

  it('timeline rows carry the day when the window spans days', async () => {
    const { unmount } = renderAt(q(night));
    expect(await screen.findByRole('button', { name: /จุดแวะที่ 1 · 23 พ\.ย\. 08:00/ })).toBeInTheDocument();
    unmount();

    renderAt(q(today));
    expect(await screen.findByRole('button', { name: /จุดแวะที่ 1 · 08:00/ })).toBeInTheDocument();
  });

  it('an empty day and a truncated day say so', async () => {
    vi.mocked(historyApi.history).mockResolvedValueOnce(route({ pointCount: 0, segments: [], timeline: [], start: null, end: null }));
    const { unmount } = renderAt(q(today));
    expect(await screen.findByText('ไม่มีข้อมูลตำแหน่งของกล้องนี้ในช่วงที่เลือก')).toBeInTheDocument();
    unmount();

    vi.mocked(historyApi.history).mockResolvedValueOnce(route({ truncated: true }));
    renderAt(q(today, '2'));
    expect(await screen.findByText(/ข้อมูลมากเกินไป/)).toBeInTheDocument();
  });

  it('a 400 INVALID_RANGE shows the server message', async () => {
    vi.mocked(historyApi.history).mockRejectedValue(
      apiError(400, { statusCode: 400, code: 'INVALID_RANGE', message: 'ดูประวัติเส้นทางได้ครั้งละไม่เกิน 24 ชั่วโมง' }),
    );
    renderAt(q(today));
    expect(await screen.findByText('ดูประวัติเส้นทางได้ครั้งละไม่เกิน 24 ชั่วโมง')).toBeInTheDocument();
  });
});

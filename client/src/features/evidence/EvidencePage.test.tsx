import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bangkokDateOf, shiftDay } from '@/features/tracking-history/historyRange';
import { apiError, renderWithProviders, signIn, signOut } from '@/test/renderPage';
import { streamingApi, type RecordingFile, type WallDevice } from '../streaming/streaming.api';
import { workOrdersApi, type WorkOrderRow } from '../work-orders/workOrders.api';
import { EvidencePage } from './EvidencePage';
import { bangkokLocalInput } from './evidenceRange';

vi.mock('../streaming/components/StreamPlayer', () => ({
  StreamPlayer: ({
    device,
    playback,
  }: {
    device: { deviceCode: string };
    playback?: { startAt: string; endAt: string };
  }) => (
    <div data-testid="player" data-device={device.deviceCode} data-start={playback?.startAt} data-end={playback?.endAt} />
  ),
}));
vi.mock('../streaming/streaming.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../streaming/streaming.api')>();
  return { ...actual, streamingApi: { ...actual.streamingApi, devices: vi.fn(), recordings: vi.fn() } };
});

vi.mock('../work-orders/workOrders.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../work-orders/workOrders.api')>();
  return { ...actual, workOrdersApi: { ...actual.workOrdersApi, list: vi.fn() } };
});

const workOrder = (id: string, from: string, to: string | null, deviceId = '1', title = 'ตรวจพื้นที่'): WorkOrderRow => ({
  id, workOrderNo: `WO-${id}`, title, status: 2, needsReview: false, team: null, leader: null,
  booking: { id, externalJobNo: null, doNo: null, shNo: null, plannedStartAt: null, plannedEndAt: null, siteName: null, detail: false },
  workWindow: { from, to }, openedAt: from, closedAt: to, lastActivityAt: null, rowVersion: 1,
  cameras: [{ deviceId, deviceRef: `CAM-${deviceId}`, deviceCode: `CAM-${deviceId}`, name: null, platformState: 'online', platformStatusFetchedAt: null, fromSession: false }],
});

const device = (id: string, code: string, extra: Partial<WallDevice> = {}): WallDevice => ({
  id,
  deviceCode: code,
  name: `กล้อง ${code}`,
  platformState: 'online',
  status: 1,
  streamingEnabled: true,
  ...extra,
});

const TODAY = bangkokDateOf(new Date());
/** A fixed past day: today's range is clipped to "now" and future-checked, which flakes just after midnight. */
const NOW_DAY = shiftDay(TODAY, -1);
const file = (startAt: string, endAt: string, extra: Partial<RecordingFile> = {}): RecordingFile => ({
  startAt,
  endAt,
  durationSeconds: (Date.parse(endAt) - Date.parse(startAt)) / 1000,
  workOrder: null,
  ...extra,
});
const at = (hhmm: string, day = NOW_DAY) => new Date(`${day}T${hhmm}:00+07:00`).toISOString();

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

const renderAt = (search = '') =>
  renderWithProviders(
    <MemoryRouter initialEntries={[`/evidence${search}`]}>
      <Routes>
        <Route
          path="/evidence"
          element={
            <>
              <EvidencePage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

/** The explicit playback action; file and timeline buttons only select a range. */
const rangePlay = () => screen.getByRole('button', { name: 'ดูย้อนหลัง' });
const fileButtons = () => within(screen.getByRole('list', { name: 'ไฟล์วิดีโอที่บันทึกไว้' })).getAllByRole('button');

describe('EvidencePage', () => {
  beforeEach(() => {
    signIn(['playback:view', 'devices:read', 'work-orders:read']);
    vi.mocked(workOrdersApi.list).mockResolvedValue({ data: [], page: 1, pageSize: 100, total: 0 });
    vi.mocked(streamingApi.devices).mockResolvedValue([
      device('1', 'CAM-1'),
      device('2', 'CAM-2', { status: 4 }),
    ]);
    vi.mocked(streamingApi.recordings).mockResolvedValue({
      data: [file(at('00:30'), at('00:45'))],
      from: '',
      to: '',
    });
  });
  afterEach(() => {
    signOut();
    vi.clearAllMocks();
  });

  it('searches once from the URL and lists the segments as not linked to a work order', async () => {
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    expect(await screen.findByText('ไม่ผูกใบงาน')).toBeInTheDocument();
    expect(streamingApi.recordings).toHaveBeenCalledTimes(1);
    expect(vi.mocked(streamingApi.recordings).mock.calls[0]![0].deviceId).toBe('1');
    expect(screen.getByText('พบ 1 ช่วง')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ค้นหาวิดีโอ' })).toBeNull();
  });

  it('shows the work order number of a linked segment', async () => {
    vi.mocked(streamingApi.recordings).mockResolvedValue({
      data: [file(at('00:30'), at('00:45'), { workOrder: { id: '9', workOrderNo: 'WO-202611-00001' } })],
      from: '',
      to: '',
    });
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    expect(await screen.findByText('WO-202611-00001')).toBeInTheDocument();
  });

  it('does not search before a camera is chosen', async () => {
    renderAt();
    expect(await screen.findByText('เลือกกล้องและวันเพื่อดูรายการวิดีโอ')).toBeInTheDocument();
    expect(streamingApi.recordings).not.toHaveBeenCalled();
  });

  it('shows an empty state when there are no segments', async () => {
    vi.mocked(streamingApi.recordings).mockResolvedValue({ data: [], from: '', to: '' });
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    expect(await screen.findByText('ไม่พบวิดีโอของกล้องนี้ในวันที่เลือก')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'จอวิดีโอย้อนหลัง' })).toHaveTextContent('ยังไม่มีไฟล์วิดีโอ');
    expect(rangePlay()).toBeDisabled();
  });

  it('explains how to open a clip before any video is playing', async () => {
    renderAt();
    const stage = screen.getByRole('status', { name: 'จอวิดีโอย้อนหลัง' });
    expect(stage).toHaveTextContent('ยังไม่มีไฟล์วิดีโอ');
    expect(stage).toHaveTextContent('เลือกกล้องและวัน');
    expect(screen.queryByTestId('player')).toBeNull();
  });

  it('selects a recording from its timeline bar and waits for Watch before playing', async () => {
    vi.mocked(streamingApi.recordings).mockResolvedValue({
      data: [file(at('09:05'), at('09:23'), { workOrder: { id: '9', workOrderNo: 'WO-015' } })],
      from: '', to: '',
    });
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    const timeline = await screen.findByRole('group', { name: 'ช่วงไฟล์บนแถบเวลา' });
    const interval = await within(timeline).findByRole('button', { name: /09:05/ });
    interval.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByTestId('player')).toBeNull();
    expect(screen.getByLabelText('สิ้นสุด')).toHaveValue(`${NOW_DAY}T09:23`);
    expect(interval).toHaveAttribute('aria-pressed', 'true');
    const selected = screen.getByRole('region', { name: 'ช่วงวิดีโอที่เลือก' });
    expect(selected).toHaveTextContent('WO-015');
    expect(selected).toHaveTextContent('18:00');
    await userEvent.click(rangePlay());
    expect(await screen.findByTestId('player')).toHaveAttribute('data-start', at('09:05'));
  });

  it('selects a recording below the timeline and fills the range without starting playback', async () => {
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    const timeline = screen.getByRole('region', { name: 'ช่วงวิดีโอในวันที่เลือก' });
    const list = await within(timeline).findByRole('list', { name: 'ไฟล์วิดีโอที่บันทึกไว้' });
    const stage = screen.getByRole('status', { name: 'จอวิดีโอย้อนหลัง' });
    expect(stage).toHaveTextContent('ยังไม่มีไฟล์วิดีโอ');
    const recording = within(list).getByRole('button', { name: /00:30/ });
    await userEvent.click(recording);

    expect(screen.queryByTestId('player')).toBeNull();
    expect(stage).not.toHaveTextContent('ยังไม่มีไฟล์วิดีโอ');
    expect(stage).toHaveTextContent('กดดูย้อนหลัง');
    expect(screen.getByLabelText('สิ้นสุด')).toHaveValue(`${NOW_DAY}T00:45`);
    expect(recording).toHaveAttribute('aria-pressed', 'true');
    const bars = within(timeline).getByRole('group', { name: 'ช่วงไฟล์บนแถบเวลา' });
    expect(within(bars).getByRole('button', { name: /00:30/ })).toHaveAttribute('aria-pressed', 'true');
    const selected = screen.getByRole('region', { name: 'ช่วงวิดีโอที่เลือก' });
    expect(within(selected).queryByRole('list')).toBeNull();
    expect(screen.getAllByRole('list', { name: 'ไฟล์วิดีโอที่บันทึกไว้' })).toHaveLength(1);
  });


  it('keeps the current player while rapidly selecting files and timeline ranges until Watch is pressed', async () => {
    vi.mocked(streamingApi.recordings).mockResolvedValue({
      data: [file(at('09:05'), at('09:23')), file(at('10:00'), at('10:30'))],
      from: '', to: '',
    });
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    await screen.findByRole('list', { name: 'ไฟล์วิดีโอที่บันทึกไว้' });
    await userEvent.click(fileButtons()[0]!);
    await userEvent.click(rangePlay());
    const current = await screen.findByTestId('player');
    const timeline = screen.getByRole('group', { name: 'ช่วงไฟล์บนแถบเวลา' });

    await userEvent.click(fileButtons()[1]!);
    await userEvent.click(within(timeline).getByRole('button', { name: /09:05/ }));
    await userEvent.click(fileButtons()[1]!);
    expect(screen.getByTestId('player')).toBe(current);
    expect(current).toHaveAttribute('data-start', at('09:05'));
    expect(screen.getByLabelText('เริ่มต้น')).toHaveValue(`${NOW_DAY}T10:00`);
    expect(screen.getByLabelText('สิ้นสุด')).toHaveValue(`${NOW_DAY}T10:30`);
    expect(fileButtons()[1]).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(rangePlay());
    const next = await screen.findByTestId('player');
    expect(next).not.toBe(current);
    expect(next).toHaveAttribute('data-start', at('10:00'));
    expect(next).toHaveAttribute('data-end', at('10:30'));
    expect(current).not.toBeInTheDocument();
  });

  it('clears the selected file highlight when its times are edited without replacing the current player', async () => {
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    await screen.findByRole('list', { name: 'ไฟล์วิดีโอที่บันทึกไว้' });
    await userEvent.click(fileButtons()[0]!);
    await userEvent.click(rangePlay());
    const current = await screen.findByTestId('player');

    fireEvent.change(screen.getByLabelText('สิ้นสุด'), { target: { value: `${NOW_DAY}T00:40:00` } });
    expect(screen.getByTestId('player')).toBe(current);
    expect(fileButtons()[0]).toHaveAttribute('aria-pressed', 'false');
    const timeline = screen.getByRole('group', { name: 'ช่วงไฟล์บนแถบเวลา' });
    expect(within(timeline).getByRole('button', { name: /00:30/ })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(rangePlay());
    expect(await screen.findByTestId('player')).toHaveAttribute('data-end', at('00:40'));
  });

  it('searches actual work orders for the camera/day and filters files by their work period without autoplay', async () => {
    vi.mocked(streamingApi.recordings).mockResolvedValue({
      data: [file(at('09:05'), at('09:23')), file(at('10:00'), at('10:30'))], from: '', to: '',
    });
    vi.mocked(workOrdersApi.list).mockResolvedValue({
      data: [
        workOrder('015', at('09:00'), at('09:30'), '1', 'ตรวจอาคาร A'),
        workOrder('016', at('10:05'), at('10:25'), '1', 'ตรวจอาคาร B'),
        workOrder('OTHER', at('10:00'), at('10:30'), '2'),
        workOrder('OLD', at('10:00', shiftDay(NOW_DAY, -1)), at('10:30', shiftDay(NOW_DAY, -1))),
      ], page: 1, pageSize: 100, total: 4,
    });
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    await screen.findByRole('list', { name: 'ไฟล์วิดีโอที่บันทึกไว้' });
    const picker = await screen.findByRole('combobox', { name: 'ใบงานของกล้อง' });
    await waitFor(() => expect(picker).toBeEnabled());
    await userEvent.click(picker);
    expect(screen.queryByRole('option', { name: /WO-OTHER/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /WO-OLD/ })).toBeNull();
    await userEvent.type(picker, 'อาคาร B');
    await userEvent.click(await screen.findByRole('option', { name: /WO-016/ }));
    expect(workOrdersApi.list).toHaveBeenCalledWith({ deviceId: '1', page: 1, pageSize: 100 });
    expect(fileButtons()).toHaveLength(1);
    expect(fileButtons()[0]).toHaveTextContent('10:00–10:30');
    expect(screen.getByLabelText('เริ่มต้น')).toHaveValue(`${NOW_DAY}T10:05`);
    expect(screen.getByLabelText('สิ้นสุด')).toHaveValue(`${NOW_DAY}T10:25`);
    expect(screen.queryByTestId('player')).toBeNull();
    expect(streamingApi.recordings).toHaveBeenCalledTimes(1);

    await userEvent.click(fileButtons()[0]!);
    expect(screen.getByLabelText('เริ่มต้น')).toHaveValue(`${NOW_DAY}T10:05`);
    expect(screen.getByLabelText('สิ้นสุด')).toHaveValue(`${NOW_DAY}T10:25`);
    expect(screen.queryByTestId('player')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'ล้างใบงาน' }));
    expect(fileButtons()).toHaveLength(2);
  });

  it('resets a work-order selection when the camera changes', async () => {
    vi.mocked(workOrdersApi.list).mockResolvedValue({
      data: [workOrder('015', at('00:30'), at('00:45'))], page: 1, pageSize: 100, total: 1,
    });
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    const picker = await screen.findByRole('combobox', { name: 'ใบงานของกล้อง' });
    await waitFor(() => expect(picker).toBeEnabled());
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole('option', { name: /WO-015/ }));
    await userEvent.click(screen.getByLabelText('กล้อง'));
    await userEvent.click(await screen.findByRole('option', { name: /CAM-2/ }));
    await waitFor(() => expect(workOrdersApi.list).toHaveBeenCalledWith({ deviceId: '2', page: 1, pageSize: 100 }));
    expect(picker).toHaveValue('');
    expect(screen.getByLabelText('เริ่มต้น')).toHaveValue('');
    expect(screen.queryByTestId('player')).toBeNull();
  });

  it('does not load work orders without work-orders:read permission', async () => {
    signIn(['playback:view', 'devices:read']);
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    expect(await screen.findByRole('combobox', { name: 'ใบงานของกล้อง' })).toBeDisabled();
    expect(workOrdersApi.list).not.toHaveBeenCalled();
  });

  it('shows a work-order loading error with a retry independent of recording search', async () => {
    vi.mocked(workOrdersApi.list).mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ data: [], page: 1, pageSize: 100, total: 0 });
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    await userEvent.click(await screen.findByRole('button', { name: 'ลองโหลดใบงานอีกครั้ง' }));
    await waitFor(() => expect(workOrdersApi.list).toHaveBeenCalledTimes(2));
    expect(streamingApi.recordings).toHaveBeenCalledTimes(1);
  });

  it('shows the error with a retry that searches again', async () => {
    vi.mocked(streamingApi.recordings)
      .mockRejectedValueOnce(apiError(502, { code: 'RECORDING_SEARCH_FAILED', message: 'ค้นไม่สำเร็จ' }))
      .mockResolvedValueOnce({ data: [file(at('00:30'), at('00:45'))], from: '', to: '' });
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    expect(await screen.findByText('ค้นหาวิดีโอไม่สำเร็จ')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    expect(await screen.findByText('ไม่ผูกใบงาน')).toBeInTheDocument();
    expect(streamingApi.recordings).toHaveBeenCalledTimes(2);
  });

  it('clips a selected midnight-crossing file to the day and plays it only on Watch', async () => {
    const dayStart = at('00:00');
    vi.mocked(streamingApi.recordings).mockResolvedValue({
      data: [file(new Date(Date.parse(dayStart) - 30 * 60_000).toISOString(), at('00:20'))],
      from: '',
      to: '',
    });
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    await screen.findByText('ไม่ผูกใบงาน');
    await userEvent.click(fileButtons()[0]!);
    expect(screen.queryByTestId('player')).toBeNull();
    expect(screen.getByLabelText('สิ้นสุด')).toHaveValue(`${NOW_DAY}T00:20`);
    await userEvent.click(rangePlay());
    const player = await screen.findByTestId('player');
    expect(player).toHaveAttribute('data-device', 'CAM-1');
    expect(player).toHaveAttribute('data-start', dayStart);
    expect(player).toHaveAttribute('data-end', at('00:20'));
    expect(screen.getByLabelText('เริ่มต้น')).toHaveValue(bangkokLocalInput(dayStart).slice(0, 16));
  });

  it('disables the play button and explains a range over 24 hours or reversed', async () => {
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    await screen.findByText('ไม่ผูกใบงาน');
    const from = screen.getByLabelText('เริ่มต้น');
    const to = screen.getByLabelText('สิ้นสุด');
    fireEvent.change(from, { target: { value: `${shiftDay(NOW_DAY, -2)}T00:00:00` } });
    fireEvent.change(to, { target: { value: `${NOW_DAY}T00:10:00` } });
    expect(screen.getByRole('alert')).toHaveTextContent('ดูย้อนหลังได้ครั้งละไม่เกิน 24 ชั่วโมง');
    expect(rangePlay()).toBeDisabled();
    fireEvent.change(from, { target: { value: `${NOW_DAY}T00:10:00` } });
    fireEvent.change(to, { target: { value: `${NOW_DAY}T00:05:00` } });
    expect(screen.getByText('เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม')).toBeInTheDocument();
    expect(rangePlay()).toBeDisabled();
    fireEvent.change(to, { target: { value: `${NOW_DAY}T00:20:00` } });
    expect(rangePlay()).toBeEnabled();
  });

  it('plays an edited range', async () => {
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    await screen.findByText('ไม่ผูกใบงาน');
    fireEvent.change(screen.getByLabelText('เริ่มต้น'), { target: { value: `${NOW_DAY}T00:10:00` } });
    fireEvent.change(screen.getByLabelText('สิ้นสุด'), { target: { value: `${NOW_DAY}T00:20:30` } });
    await userEvent.click(rangePlay());
    const player = await screen.findByTestId('player');
    expect(player).toHaveAttribute('data-start', at('00:10'));
    expect(player).toHaveAttribute('data-end', new Date(`${NOW_DAY}T00:20:30+07:00`).toISOString());
  });

  it('pressing play again with an unchanged range remounts the player (a server-closed playback can be replayed)', async () => {
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    await screen.findByText('ไม่ผูกใบงาน');
    await userEvent.click(fileButtons()[0]!);
    await userEvent.click(rangePlay());
    const first = await screen.findByTestId('player');
    await userEvent.click(rangePlay());
    await waitFor(() => expect(screen.getByTestId('player')).not.toBe(first));
    expect(first).not.toBeInTheDocument();
  });

  it('unmounts the previous player and searches again when the day changes; the URL follows', async () => {
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    await screen.findByText('ไม่ผูกใบงาน');
    await userEvent.click(fileButtons()[0]!);
    await userEvent.click(rangePlay());
    const player = await screen.findByTestId('player');
    const yesterday = shiftDay(NOW_DAY, -1);
    await userEvent.selectOptions(screen.getByLabelText('วัน'), yesterday);
    await waitFor(() => expect(player).not.toBeInTheDocument());
    expect(screen.queryByTestId('player')).toBeNull();
    await waitFor(() => expect(streamingApi.recordings).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('location')).toHaveTextContent(`date=${yesterday}`);
    expect(screen.getByTestId('location')).toHaveTextContent('deviceId=1');
  });

  it('unmounts the previous player and searches again when the camera changes (retired cameras are listed)', async () => {
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    await screen.findByText('ไม่ผูกใบงาน');
    await userEvent.click(fileButtons()[0]!);
    await userEvent.click(rangePlay());
    const player = await screen.findByTestId('player');
    await userEvent.click(screen.getByLabelText('กล้อง'));
    await userEvent.click(await screen.findByRole('option', { name: /CAM-2/ }));
    await waitFor(() => expect(player).not.toBeInTheDocument());
    await waitFor(() => expect(streamingApi.recordings).toHaveBeenCalledTimes(2));
    expect(vi.mocked(streamingApi.recordings).mock.calls[1]![0].deviceId).toBe('2');
    expect(screen.getByTestId('location')).toHaveTextContent('deviceId=2');
  });

  it('keeps the segment list inside its own region', async () => {
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    await screen.findByText('ไม่ผูกใบงาน');
    const region = screen.getByRole('region', { name: 'ไฟล์วิดีโอที่บันทึกไว้' });
    expect(within(region).getByText('ไม่ผูกใบงาน')).toBeInTheDocument();
  });

  it('highlights the row of a file that crosses midnight after it is clicked', async () => {
    const dayStart = at('00:00');
    vi.mocked(streamingApi.recordings).mockResolvedValue({
      data: [
        file(new Date(Date.parse(dayStart) - 30 * 60_000).toISOString(), at('00:20')),
        file(at('01:00'), at('01:10')),
      ],
      from: '',
      to: '',
    });
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    await screen.findAllByText('ไม่ผูกใบงาน');
    const rows = fileButtons();
    expect(rows[0]).not.toHaveClass('bg-accent');
    await userEvent.click(rows[0]!);
    expect(screen.queryByTestId('player')).toBeNull();
    expect(fileButtons()[0]).toHaveClass('bg-accent');
    expect(fileButtons()[1]).not.toHaveClass('bg-accent');
  });

  it('labels the days in the Buddhist year for Thai', async () => {
    renderAt(`?deviceId=1&date=${NOW_DAY}`);
    await screen.findByText('ไม่ผูกใบงาน');
    const options = within(screen.getByLabelText('วัน')).getAllByRole('option');
    const buddhist = Number(TODAY.slice(0, 4)) + 543;
    expect(options[0]!.textContent).toMatch(/^วันนี้ · /);
    expect(options[0]!.textContent?.endsWith(` ${buddhist}`)).toBe(true);
    expect(options[0]!.textContent).not.toContain(TODAY.slice(0, 4));
  });

  it('moves the day list past midnight without a reload', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      vi.setSystemTime(new Date('2026-11-26T16:59:40.000Z')); // 23:59:40 on 26 Nov, Bangkok
      renderAt();
      const select = screen.getByLabelText('วัน') as HTMLSelectElement;
      expect(select.options[0]!.value).toBe('2026-11-26');
      expect(select.options[29]!.value).toBe('2026-10-28');
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(select.options[0]!.value).toBe('2026-11-27');
      expect(select.options[0]!.textContent).toContain('วันนี้');
      expect(select.options[29]!.value).toBe('2026-10-29');
      expect(select.options[1]!.textContent).not.toContain('วันนี้');
    } finally {
      vi.useRealTimers();
    }
  });
});

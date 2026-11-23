import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiError, renderWithProviders, signIn, signOut } from '@/test/renderPage';
import { historyApi, type RouteHistory } from './history.api';
import { dayWindowOf, bangkokDateOf, shiftDay } from './historyRange';
import { HistoryPage } from './HistoryPage';

vi.mock('@/components/map/MapCanvas', () => ({
  MapCanvas: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
}));
vi.mock('./components/RouteLayers', () => ({
  RouteLayers: ({ route }: { route: RouteHistory }) => <div data-testid="route">{route.segments.length} segments</div>,
}));
vi.mock('./history.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./history.api')>();
  return { ...actual, historyApi: { devices: vi.fn(), history: vi.fn() } };
});

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
    },
  ],
  ...extra,
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

const renderAt = (search = '') =>
  renderWithProviders(
    <MemoryRouter initialEntries={[`/tracking/history${search}`]}>
      <Routes>
        <Route
          path="/tracking/history"
          element={
            <>
              <HistoryPage />
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

describe('HistoryPage', () => {
  beforeEach(() => {
    signIn(['tracking:history', 'devices:read']);
    vi.mocked(historyApi.devices).mockResolvedValue([
      { id: '1', deviceCode: 'SIM-0001', name: 'กล้องจำลอง 1' },
      { id: '2', deviceCode: 'SIM-0002', name: null },
    ]);
    vi.mocked(historyApi.history).mockResolvedValue(route());
  });
  afterEach(() => {
    signOut();
    vi.clearAllMocks();
  });

  it('asks for a camera first; picking one loads today once', async () => {
    const user = userEvent.setup();
    renderAt();
    expect(screen.getByRole('heading', { name: 'ประวัติเส้นทาง' })).toBeInTheDocument();
    expect(screen.getByText('เลือกกล้องเพื่อดูเส้นทาง')).toBeInTheDocument();
    expect(historyApi.history).not.toHaveBeenCalled();

    const select = screen.getByLabelText('กล้อง');
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3));
    await user.selectOptions(select, '1');

    await waitFor(() => expect(historyApi.history).toHaveBeenCalledTimes(1));
    expect(historyApi.history).toHaveBeenCalledWith('1', today.from, today.to);
    expect(screen.getByTestId('location').textContent).toBe(q(today));
  });

  it('shows the summary, the route and the timeline of the chosen day', async () => {
    renderAt(q(today));
    expect(await screen.findByTestId('route')).toHaveTextContent('1 segments');
    expect(screen.getByText(/41 จุด/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /จุดแวะที่ 1/ })).toBeInTheDocument();
    expect(historyApi.history).toHaveBeenCalledTimes(1);
  });

  it('previous day moves the window; next day is disabled on today', async () => {
    const user = userEvent.setup();
    renderAt(q(today));
    await screen.findByTestId('route');
    expect(screen.getByRole('button', { name: 'วันถัดไป' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'วันก่อนหน้า' }));
    await waitFor(() => expect(historyApi.history).toHaveBeenLastCalledWith('1', yesterday.from, yesterday.to));
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

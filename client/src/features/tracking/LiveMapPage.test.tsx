import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClusterMarker } from '@/components/map/MarkerClusterLayer';
import { renderWithProviders, signIn, signOut } from '@/test/renderPage';
import { LiveMapPage } from './LiveMapPage';
import type { LiveDevice } from './liveMerge';

// Leaflet is exercised in the map component tests; here the map is a plain list of marker buttons.
vi.mock('@/components/map/MapCanvas', () => ({
  MapCanvas: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
}));
vi.mock('@/components/map/MarkerClusterLayer', () => ({
  MarkerClusterLayer: ({ markers }: { markers: ClusterMarker[] }) => (
    <ul aria-label="markers">
      {markers.map((m) => (
        <li key={m.id}>
          <button type="button" onClick={m.onClick} data-html={String(m.icon.options.html)}>
            marker {m.title}
          </button>
        </li>
      ))}
    </ul>
  ),
}));
vi.mock('./components/LiveMapViewport', () => ({ LiveMapViewport: () => null }));

const live = vi.hoisted(() => ({ devices: [] as LiveDevice[], isPending: false, isError: false }));
vi.mock('./useLivePositions', () => ({
  useLivePositions: () => ({ ...live, fixActiveSeconds: 150, refetch: vi.fn() }),
}));

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
const device = (id: string, extra: Partial<LiveDevice> = {}): LiveDevice => ({
  id,
  deviceCode: `SIM-000${id}`,
  name: `กล้องจำลอง ${id}`,
  lat: 13.75,
  lng: 100.5,
  speedKph: null,
  lastFixAt: ago(30),
  platformState: 'online',
  platformStatusFetchedAt: ago(5),
  live: false,
  ...extra,
});

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter>
      <LiveMapPage />
    </MemoryRouter>,
  );

describe('LiveMapPage', () => {
  beforeEach(() => {
    live.isPending = false;
    live.isError = false;
    live.devices = [
      device('1'),
      device('2', { platformState: 'offline', lat: null, lng: null, lastFixAt: null }),
      device('3', { lastFixAt: ago(600) }),
    ];
    signIn(['tracking:view', 'tracking:history']);
  });
  afterEach(() => signOut());

  it('lists every camera and puts the ones with a position on the map (old fixes dimmed)', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'แผนที่ติดตาม' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'รายการกล้อง' });
    expect(within(list).getAllByRole('button', { name: /แสดง .* บนแผนที่/ })).toHaveLength(3);

    const markers = within(screen.getByRole('list', { name: 'markers' })).getAllByRole('button');
    expect(markers.map((m) => m.textContent)).toEqual(['marker SIM-0001', 'marker SIM-0003']);
    expect(markers[0].dataset.html).not.toContain('data-stale');
    expect(markers[1].dataset.html).toContain('data-stale');
  });

  it('filters the list by status and by search', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'ออฟไลน์' }));
    const list = screen.getByRole('list', { name: 'รายการกล้อง' });
    expect(within(list).getAllByRole('button', { name: /แสดง .* บนแผนที่/ }).map((b) => b.textContent)).toEqual([
      expect.stringContaining('SIM-0002'),
    ]);
    await user.click(screen.getByRole('tab', { name: 'ทั้งหมด' }));
    await user.type(screen.getByLabelText('ค้นหากล้อง'), '0003');
    expect(within(list).getAllByRole('button', { name: /แสดง .* บนแผนที่/ })).toHaveLength(1);
  });

  it('a click on the list opens the card with a link to the route history', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'แสดง SIM-0001 บนแผนที่' }));
    const card = screen.getByRole('region', { name: 'SIM-0001' });
    expect(within(card).getByText('ออนไลน์')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'ประวัติเส้นทาง' })).toHaveAttribute(
      'href',
      '/tracking/history?deviceId=1',
    );
  });

  it('a click on a marker opens the same card; no history link without tracking:history', async () => {
    signIn(['tracking:view']);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'marker SIM-0003' }));
    const card = screen.getByRole('region', { name: 'SIM-0003' });
    expect(within(card).queryByRole('link', { name: 'ประวัติเส้นทาง' })).not.toBeInTheDocument();
    expect(within(card).getByText(/10 นาทีที่แล้ว/)).toBeInTheDocument();
  });

  it('a marker dims once its fix gets old, even when no new data arrives (review #7)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      live.devices = [device('1', { lastFixAt: ago(30) })];
      renderPage();
      const marker = () => screen.getByRole('button', { name: 'marker SIM-0001' });
      expect(marker().dataset.html).not.toContain('data-stale');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_000);
      });
      expect(marker().dataset.html).toContain('data-stale');
    } finally {
      vi.useRealTimers();
    }
  });

  it('an empty system says so', () => {
    live.devices = [];
    renderPage();
    expect(screen.getByText('ยังไม่มีกล้องในระบบ')).toBeInTheDocument();
  });

  it('shows a loading state instead of an empty camera list while the snapshot loads', () => {
    live.devices = [];
    live.isPending = true;
    renderPage();
    expect(screen.getByRole('status', { name: 'กำลังโหลดข้อมูล' })).toBeInTheDocument();
    expect(screen.queryByText('ยังไม่มีกล้องในระบบ')).not.toBeInTheDocument();
    expect(screen.getByLabelText('ค้นหากล้อง')).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'ออฟไลน์' })).toBeDisabled();
  });

  it('shows camera details in the list and selects or clears the camera in place', async () => {
    const user = userEvent.setup();
    renderPage();
    const card = screen.getByRole('region', { name: 'SIM-0001' });
    expect(within(card).getByText('13.75000, 100.50000')).toBeInTheDocument();
    const select = within(card).getByRole('button', { name: 'แสดง SIM-0001 บนแผนที่' });
    expect(select).toHaveAttribute('aria-pressed', 'false');
    await user.click(select);
    expect(select).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(card).getByRole('button', { name: 'ปิดรายละเอียดกล้อง' }));
    expect(select).toHaveAttribute('aria-pressed', 'false');
    expect(card).toBeInTheDocument();
  });

  it('copies coordinates without selecting the camera', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    renderPage();
    const card = screen.getByRole('region', { name: 'SIM-0001' });
    await user.click(within(card).getByRole('button', { name: 'คัดลอกพิกัด' }));
    expect(writeText).toHaveBeenCalledWith('13.75000, 100.50000');
    expect(within(card).getByRole('button', { name: 'แสดง SIM-0001 บนแผนที่' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not label an old GPS fix as online', () => {
    renderPage();
    expect(within(screen.getByRole('region', { name: 'SIM-0003' })).getByText('GPS: ไม่ทราบสถานะ')).toBeInTheDocument();
  });
});

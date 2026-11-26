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
vi.mock('react-leaflet', async () => {
  const { forwardRef } = await import('react');
  return {
    Popup: forwardRef<HTMLDivElement, { children: ReactNode; position: [number, number]; autoPan?: boolean }>(
      ({ children, position, autoPan }, ref) => {
        void ref; // The popup's imperative Leaflet methods are exercised in browser QA.
        return <div data-testid="camera-popup" data-position={JSON.stringify(position)} data-auto-pan={String(autoPan)}>{children}</div>;
      },
    ),
    useMapEvent: () => null,
    useMap: () => null,
  };
});
vi.mock('./components/LiveMapViewport', () => ({ LiveMapViewport: () => null }));
vi.mock('@/features/streaming/components/StreamPlayer', () => ({
  StreamPlayer: ({ device }: { device: { deviceCode: string } }) => <div data-testid="player">{device.deviceCode}</div>,
}));

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
    signIn(['tracking:view', 'tracking:history', 'streaming:view-live']);
  });
  afterEach(() => signOut());

  it('keeps the camera list expanded and searches it without a collapse control', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole('list', { name: 'รายการกล้อง' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'กล้องในระบบ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /กล้องในระบบ/ })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('ค้นหากล้อง'), '0003');
    expect(within(screen.getByRole('list', { name: 'รายการกล้อง' })).getAllByRole('button', { name: /แสดง .* บนแผนที่/ })).toHaveLength(1);
  });

  it('places the map title, view switch, status totals and visible filters in the camera rail', () => {
    renderPage();
    const rail = screen.getByRole('complementary', { name: 'รายการกล้อง' });
    expect(within(rail).getByRole('heading', { name: 'แผนที่ติดตาม' })).toBeInTheDocument();
    expect(within(rail).getByRole('navigation', { name: 'มุมมองแผนที่' })).toBeInTheDocument();
    expect(rail.querySelector('dl')).toHaveTextContent('อุปกรณ์3');
    expect(within(rail).getByRole('tablist', { name: 'สถานะ' })).toBeInTheDocument();
  });

  it('lists every camera and puts the ones with a position on the map (old fixes dimmed)', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'แผนที่ติดตาม' })).toBeInTheDocument();

    const markers = within(screen.getByRole('list', { name: 'markers' })).getAllByRole('button');
    expect(markers.map((m) => m.textContent)).toEqual(['marker SIM-0001', 'marker SIM-0003']);
    expect(markers[0].dataset.html).not.toContain('data-stale');
    expect(markers[1].dataset.html).toContain('data-stale');
    const list = screen.getByRole('list', { name: 'รายการกล้อง' });
    expect(within(list).getAllByRole('button', { name: /แสดง .* บนแผนที่/ })).toHaveLength(3);
  });

  it('filters the list by status and by search', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'ออฟไลน์' }));
    const list = screen.getByRole('list', { name: 'รายการกล้อง' });
    expect(within(list).getAllByRole('button', { name: /แสดง .* บนแผนที่/ })).toHaveLength(1);
    expect(within(list).getByRole('button', { name: 'แสดง SIM-0002 บนแผนที่' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'ทั้งหมด' }));
    await user.type(screen.getByLabelText('ค้นหากล้อง'), '0003');
    expect(within(list).getAllByRole('button', { name: /แสดง .* บนแผนที่/ })).toHaveLength(1);
  });

  it('opens details above the selected marker inside the map, with no bottom overlay', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'แสดง SIM-0001 บนแผนที่' }));
    const card = screen.getByRole('region', { name: 'ข้อมูลกล้อง SIM-0001' });
    expect(within(card).getByText('GPS: ออนไลน์')).toBeInTheDocument();
    expect(within(screen.getByTestId('map')).getByTestId('camera-popup')).toHaveAttribute('data-position', '[13.75,100.5]');
    expect(screen.queryByRole('region', { name: 'SIM-0001' })).not.toBeInTheDocument();
    const href = within(card).getByRole('link', { name: /ดูเส้นทางวันนี้/ }).getAttribute('href') ?? '';
    expect(href).toMatch(/^\/tracking\?view=history&deviceId=1&from=.+&to=.+$/);
  });

  it('a click on a marker opens the same card; no history link without tracking:history', async () => {
    act(() => signIn(['tracking:view']));
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'marker SIM-0003' }));
    const card = screen.getByRole('region', { name: 'ข้อมูลกล้อง SIM-0003' });
    expect(screen.getByTestId('camera-popup')).toHaveAttribute('data-auto-pan', 'false');
    expect(within(card).queryByRole('link', { name: /ดูเส้นทางวันนี้/ })).not.toBeInTheDocument();
    expect(within(card).getByText(/10 นาทีที่แล้ว/)).toBeInTheDocument();
  });

  it('selecting another marker replaces the marker popup and closing them clears selection', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'แสดง SIM-0001 บนแผนที่' }));
    expect(screen.getByRole('region', { name: 'ข้อมูลกล้อง SIM-0001' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'marker SIM-0003' }));
    expect(screen.queryByRole('region', { name: 'ข้อมูลกล้อง SIM-0001' })).not.toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'ข้อมูลกล้อง SIM-0003' });
    await user.click(within(card).getByRole('button', { name: 'ปิดรายละเอียดกล้อง' }));
    expect(screen.queryByRole('region', { name: 'ข้อมูลกล้อง SIM-0003' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'marker SIM-0003' }).dataset.html).not.toContain('data-selected');
  });

  it('filtering away the selected camera removes its marker popup', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'แสดง SIM-0001 บนแผนที่' }));
    await user.click(screen.getByRole('tab', { name: 'ออฟไลน์' }));
    expect(screen.queryByRole('region', { name: 'ข้อมูลกล้อง SIM-0001' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'marker SIM-0001' })).not.toBeInTheDocument();
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

  it('ดูภาพสด on a card opens the live dialog for that camera', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'แสดง SIM-0003 บนแผนที่' }));
    const card = screen.getByRole('region', { name: 'ข้อมูลกล้อง SIM-0003' });
    await user.click(within(card).getByRole('button', { name: 'ดูภาพสด' }));
    const dialog = await screen.findByRole('dialog', { name: /กล้องจำลอง 3/ });
    expect(within(dialog).getByTestId('player')).toHaveTextContent('SIM-0003');
    await user.click(within(dialog).getByRole('button', { name: 'ปิดจอ' }));
    expect(screen.queryByTestId('player')).not.toBeInTheDocument();
  });

  it('an empty system says so', async () => {
    live.devices = [];
    renderPage();
    expect(screen.getByText('ยังไม่มีกล้องในระบบ')).toBeInTheDocument();
  });

  it('shows a loading state instead of an empty camera list while the snapshot loads', async () => {
    live.devices = [];
    live.isPending = true;
    renderPage();
    expect(screen.getByRole('status', { name: 'กำลังโหลดข้อมูล' })).toBeInTheDocument();
    expect(screen.queryByText('ยังไม่มีกล้องในระบบ')).not.toBeInTheDocument();
    expect(screen.getByLabelText('ค้นหากล้อง')).toBeDisabled();
    for (const tab of screen.getAllByRole('tab')) expect(tab).toBeDisabled();
  });

  it('keeps details open when the same camera is selected again, until explicitly closed', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'แสดง SIM-0001 บนแผนที่' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'ข้อมูลกล้อง SIM-0001' })).getByText('13.75000, 100.50000')).toBeInTheDocument();
    const selected = screen.getByRole('button', { name: 'แสดง SIM-0001 บนแผนที่' });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    await user.click(selected);
    expect(screen.getByRole('region', { name: 'ข้อมูลกล้อง SIM-0001' })).toBeInTheDocument();
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'ปิดรายละเอียดกล้อง' }));
    expect(screen.queryByRole('region', { name: 'ข้อมูลกล้อง SIM-0001' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'marker SIM-0001' }).dataset.html).not.toContain('data-selected');
  });

  it('copies coordinates from marker popup without clearing the selected camera', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    renderPage();
    await user.click(screen.getByRole('button', { name: 'แสดง SIM-0001 บนแผนที่' }));
    const card = screen.getByRole('region', { name: 'ข้อมูลกล้อง SIM-0001' });
    await user.click(within(card).getByRole('button', { name: 'คัดลอกพิกัด' }));
    expect(writeText).toHaveBeenCalledWith('13.75000, 100.50000');
    expect(screen.getByRole('button', { name: 'marker SIM-0001' }).dataset.html).toContain('data-selected');
  });

  it('does not label an old GPS fix as online', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'แสดง SIM-0003 บนแผนที่' }));
    expect(within(screen.getByRole('region', { name: 'ข้อมูลกล้อง SIM-0003' })).getByText('GPS: ไม่ทราบสถานะ')).toBeInTheDocument();
  });

  it('can select a camera without coordinates and enforces live-view permissions', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'แสดง SIM-0002 บนแผนที่' }));
    const card = screen.getByRole('region', { name: 'ข้อมูลกล้อง SIM-0002' });
    expect(screen.getByRole('complementary', { name: 'รายการกล้อง' })).toContainElement(card);
    expect(screen.queryByTestId('camera-popup')).not.toBeInTheDocument();
    expect(within(card).getByText('ไม่มีพิกัด')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'คัดลอกพิกัด' })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'ดูภาพสด' })).toBeDisabled();
    act(() => signIn(['tracking:view']));
    expect(screen.queryByRole('button', { name: 'ดูภาพสด' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /ดูเส้นทางวันนี้/ })).not.toBeInTheDocument();
  });
});

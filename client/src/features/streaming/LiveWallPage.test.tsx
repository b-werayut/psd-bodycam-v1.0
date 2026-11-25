import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderPage';
import { LiveWallPage } from './LiveWallPage';
import { streamingApi, type WallDevice } from './streaming.api';
import { WALL_CAMERA_MIME } from './components/LiveWallCameraList';

vi.mock('./streaming.api', async (original) => ({
  ...await original<typeof import('./streaming.api')>(),
  streamingApi: { devices: vi.fn(), mySessions: vi.fn() },
}));
// Player lifecycle/media are covered separately. Here we verify camera-to-screen interactions.
vi.mock('./components/StreamPlayer', () => ({ StreamPlayer: ({ device }: { device: { deviceCode: string } }) => <output>Playing {device.deviceCode}</output> }));
const camera = (id: string, platformState: WallDevice['platformState'] = 'online'): WallDevice => ({
  id, deviceCode: `CAM-${id}`, name: `Camera ${id}`, platformState, status: 1, streamingEnabled: true,
});
const renderWall = (search = '') => renderWithProviders(<MemoryRouter initialEntries={[`/live-wall${search}`]}><LiveWallPage /></MemoryRouter>);
beforeEach(() => {
  window.localStorage.setItem('bodycam.language', 'th');
  vi.mocked(streamingApi.devices).mockResolvedValue([camera('1'), camera('2'), camera('3', 'offline')]);
  vi.mocked(streamingApi.mySessions).mockResolvedValue({ data: [], limit: 16 });
});

describe('LiveWallPage', () => {
  it('places cameras in successive slots, selects an existing camera and closes every player', async () => {
    const user = userEvent.setup();
    renderWall();
    await user.click(await screen.findByRole('button', { name: /Camera 1.*CAM-1/ }));
    expect(await screen.findByText('Playing CAM-1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Camera 2.*CAM-2/ }));
    expect(await screen.findByText('Playing CAM-2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Camera 1.*CAM-1/ }));
    expect(screen.getAllByText('Playing CAM-1')).toHaveLength(1);
    const first = screen.getByRole('region', { name: 'จอ 1 · Camera 1' });
    expect(first).toHaveAttribute('data-selected', 'true');
    expect(screen.getByRole('button', { name: /Camera 3.*CAM-3/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'ปิดทุกจอ' }));
    await waitFor(() => expect(screen.queryByText(/Playing CAM-/)).not.toBeInTheDocument());
  });
  it('keeps assigned cameras when expanding the grid and swaps cameras on drop', async () => {
    const user = userEvent.setup();
    renderWall('?c=CAM-1&c=CAM-2&c=&c=');
    await screen.findByText('Playing CAM-1');
    await user.click(screen.getByRole('button', { name: 'แบ่ง 9 จอ' }));
    expect(screen.getByRole('group', { name: 'จอภาพสด' })).toHaveAttribute('data-columns', '3');
    const second = screen.getByRole('region', { name: 'จอ 2 · Camera 2' });
    fireEvent.drop(second, { dataTransfer: { getData: (mime: string) => mime === WALL_CAMERA_MIME ? 'CAM-1' : '', types: [WALL_CAMERA_MIME] } });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'จอ 2 · Camera 1' })).getByText('Playing CAM-1')).toBeInTheDocument());
    expect(within(screen.getByRole('region', { name: 'จอ 1 · Camera 2' })).getByText('Playing CAM-2')).toBeInTheDocument();
  });
  it('blocks a layout beyond the quota and lets the camera list be searched', async () => {
    vi.mocked(streamingApi.mySessions).mockResolvedValue({ data: [], limit: 6 });
    const user = userEvent.setup();
    renderWall();
    await waitFor(() => expect(screen.getByRole('button', { name: 'แบ่ง 9 จอ' })).toBeDisabled());
    await user.type(screen.getByRole('searchbox', { name: 'ค้นหาชื่อหรือรหัสกล้อง' }), 'CAM-2');
    expect(screen.queryByRole('button', { name: /Camera 1/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Camera 2/ })).toBeInTheDocument();
  });
});

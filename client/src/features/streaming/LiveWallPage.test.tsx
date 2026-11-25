import { useEffect } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TalkSession, TalkState } from '@/features/talk/useTalkSession';
import { renderWithProviders, signIn } from '@/test/renderPage';
import { LiveWallPage } from './LiveWallPage';
import { streamingApi, type WallDevice } from './streaming.api';
import { WALL_CAMERA_MIME } from './components/LiveWallCameraList';

vi.mock('./streaming.api', async (original) => ({
  ...await original<typeof import('./streaming.api')>(),
  streamingApi: { devices: vi.fn(), mySessions: vi.fn() },
}));
// Player lifecycle/media are covered separately. Here we verify camera-to-screen interactions.
vi.mock('./components/StreamPlayer', () => ({
  StreamPlayer: ({ device, onSessionChange }: { device: { deviceCode: string }; onSessionChange?: (session: unknown) => void }) => {
    useEffect(() => {
      onSessionChange?.({ sessionToken: `tok-${device.deviceCode}`, protocol: 1, device: { id: device.deviceCode, deviceCode: device.deviceCode, deviceName: null }, channel: 1, playbackUrl: '/x', idleTimeoutSeconds: 300 });
    }, [device.deviceCode, onSessionChange]);
    return <output>Playing {device.deviceCode}</output>;
  },
}));
// jsdom has no secure context / AudioWorklet: treat the browser as talk-capable.
vi.mock('@/features/talk/talkRules', async (original) => ({ ...await original<typeof import('@/features/talk/talkRules')>(), browserSupportsTalk: () => true }));
const talk = vi.hoisted(() => ({ stateByToken: new Map<string, string>(), lastToken: null as string | null, starts: 0 }));
vi.mock('@/features/talk/useTalkSession', async (original) => ({
  ...await original<typeof import('@/features/talk/useTalkSession')>(),
  useTalkSession: (token: string | null): TalkSession => {
    talk.lastToken = token;
    return {
      state: ((token && talk.stateByToken.get(token)) || 'idle') as TalkState,
      notice: null, elapsedSeconds: 0, maxSeconds: null, muted: false, micLevel: 0, readLevel: () => 0,
      start: () => { talk.starts += 1; }, hangUp: () => undefined, toggleMute: () => undefined, stop: () => undefined,
    };
  },
}));
const camera = (id: string, platformState: WallDevice['platformState'] = 'online'): WallDevice => ({
  id, deviceCode: `CAM-${id}`, name: `Camera ${id}`, platformState, status: 1, streamingEnabled: true,
});
const renderWall = (search = '') => renderWithProviders(<MemoryRouter initialEntries={[`/live-wall${search}`]}><LiveWallPage /></MemoryRouter>);
beforeEach(() => {
  talk.stateByToken.clear();
  talk.lastToken = null;
  talk.starts = 0;
  signIn(['streaming:talk']);
  window.localStorage.setItem('bodycam.language', 'th');
  vi.mocked(streamingApi.devices).mockResolvedValue([camera('1'), camera('2'), camera('3', 'offline')]);
  vi.mocked(streamingApi.mySessions).mockResolvedValue({ data: [], limit: 16 });
});

describe('LiveWallPage', () => {
  it('filters cameras by connectivity and search without closing an assigned screen', async () => {
    const user = userEvent.setup();
    renderWall();
    await user.click(await screen.findByRole('button', { name: /Camera 1.*CAM-1/ }));
    await screen.findByText('Playing CAM-1');
    await user.click(screen.getByRole('tab', { name: 'ออฟไลน์' }));
    expect(screen.getByRole('button', { name: /Camera 3.*CAM-3/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Camera 2.*CAM-2/ })).not.toBeInTheDocument();
    expect(screen.getByText('Playing CAM-1')).toBeInTheDocument();
    expect(screen.getByText('ออนไลน์ 2 จาก 3')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'CAM-2');
    expect(screen.getByText('ไม่พบกล้องที่ตรงกับตัวกรอง')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ล้างตัวกรอง' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('tab', { name: 'ทั้งหมด' })).toHaveAttribute('data-state', 'active');
    expect(screen.getByRole('button', { name: /Camera 2.*CAM-2/ })).toBeInTheDocument();
  });

  it('lets operators show only online or unknown cameras', async () => {
    vi.mocked(streamingApi.devices).mockResolvedValue([camera('1'), camera('2', 'offline'), camera('3', 'unknown')]);
    const user = userEvent.setup();
    renderWall();
    await screen.findByRole('button', { name: /Camera 1.*CAM-1/ });
    await user.click(screen.getByRole('tab', { name: 'ออนไลน์' }));
    expect(screen.getByRole('button', { name: /Camera 1.*CAM-1/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Camera 2.*CAM-2/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'ไม่ทราบ' }));
    expect(screen.getByRole('button', { name: /Camera 3.*CAM-3/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Camera 1.*CAM-1/ })).not.toBeInTheDocument();
  });

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

describe('LiveWallPage — talk through the camera', () => {
  const talkPanel = () => document.querySelector<HTMLElement>('[data-slot="live-wall-talk"]')!;
  const tile = (n: number) => screen.getByRole('region', { name: new RegExp(`^จอ ${n}(?![0-9])`) });
  const selectButton = (n: number) => within(tile(n)).getByRole('button', { name: new RegExp(`^จอ ${n}(?![0-9])`) });

  it('shows the selected screen camera in the panel and the no-target hint on an empty screen', async () => {
    renderWall('?c=CAM-1&c=');
    await screen.findByText('Playing CAM-1');
    expect(within(talkPanel()).getByText('จอ 1 · Camera 1')).toBeInTheDocument();
    const button = within(talkPanel()).getByRole('button', { name: 'เริ่มการสนทนา' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(talk.starts).toBe(1);
    fireEvent.click(selectButton(2));
    expect(within(talkPanel()).getByText('เลือกจอที่มีกล้องก่อน')).toBeInTheDocument();
  });

  it('hides the talk panel without streaming:talk while tiles still render', async () => {
    signIn([]);
    renderWall('?c=CAM-1&c=');
    await screen.findByText('Playing CAM-1');
    expect(talkPanel()).toBeNull();
    expect(tile(1)).toBeInTheDocument();
  });

  it('keeps the call on its original tile when the selection moves during a call', async () => {
    talk.stateByToken.set('tok-CAM-1', 'active');
    renderWall('?c=CAM-1&c=CAM-2');
    await within(tile(1)).findByText('กำลังคุย');
    fireEvent.click(selectButton(2));
    await screen.findByText('Playing CAM-2');
    await waitFor(() => expect(talk.lastToken).toBe('tok-CAM-1'));
    expect(within(talkPanel()).getByText('จอ 1 · Camera 1')).toBeInTheDocument();
    expect(within(tile(1)).getByText('กำลังคุย')).toBeInTheDocument();
  });

  it('hands null to the hook when the talking tile is closed', async () => {
    talk.stateByToken.set('tok-CAM-1', 'active');
    renderWall('?c=CAM-1&c=');
    await within(tile(1)).findByText('กำลังคุย');
    fireEvent.click(within(tile(1)).getByRole('button', { name: 'ปิดภาพจอ 1' }));
    await waitFor(() => expect(talk.lastToken).toBeNull());
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/i18n/LanguageProvider';
import { signIn, signOut } from '@/test/renderPage';
import { WorkOrderCameraList } from './WorkOrderCameraList';
import type { WorkOrderCamera } from './workOrders.api';

const camera = (extra: Partial<WorkOrderCamera> = {}): WorkOrderCamera => ({
  deviceRef: 'REF-1',
  deviceId: '1',
  deviceCode: 'BC-001',
  name: 'กล้อง 1',
  platformState: 'online',
  platformStatusFetchedAt: new Date().toISOString(),
  fromSession: false,
  ...extra,
});

function renderList(cameras: WorkOrderCamera[], detailed: boolean, onWatch: (() => void) | null = vi.fn(), onRowClick = vi.fn()) {
  render(
    <LanguageProvider>
      <div onClick={onRowClick}>
        <WorkOrderCameraList cameras={cameras} detailed={detailed} onWatch={onWatch ?? undefined} />
      </div>
    </LanguageProvider>,
  );
  return { onWatch, onRowClick };
}

const watchButton = () => screen.queryByRole('button', { name: /ดูสด/ });

describe('WorkOrderCameraList ดูสด', () => {
  afterEach(() => signOut());

  it.each([false, true])('shows for an online camera with permission (detailed=%s)', (detailed) => {
    signIn(['streaming:view-live']);
    renderList([camera()], detailed);
    expect(screen.getByRole('button', { name: 'ดูสด BC-001' })).toBeInTheDocument();
  });

  it.each([
    ['offline', { platformState: 'offline' as const }],
    ['unknown', { platformState: 'unknown' as const }],
    ['no deviceId', { deviceId: null }],
    ['no deviceCode', { deviceCode: null }],
  ])('is hidden for %s', (_label, extra) => {
    signIn(['streaming:view-live']);
    renderList([camera(extra)], false);
    renderList([camera(extra)], true);
    expect(watchButton()).not.toBeInTheDocument();
  });

  it('is hidden without streaming:view-live', () => {
    signIn(['tracking:view']);
    renderList([camera()], false);
    expect(watchButton()).not.toBeInTheDocument();
  });

  it.each([false, true])('is hidden when the caller gives no onWatch (detailed=%s)', (detailed) => {
    signIn(['streaming:view-live']);
    renderList([camera()], detailed, null);
    expect(watchButton()).not.toBeInTheDocument();
  });

  it.each([false, true])('calls onWatch with the camera and button, without triggering the parent click (detailed=%s)', async (detailed) => {
    signIn(['streaming:view-live']);
    const { onWatch, onRowClick } = renderList([camera()], detailed);
    const button = screen.getByRole('button', { name: 'ดูสด BC-001' });
    await userEvent.click(button);
    expect(onWatch).toHaveBeenCalledTimes(1);
    expect(onWatch).toHaveBeenCalledWith(expect.objectContaining({ deviceCode: 'BC-001' }), button);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

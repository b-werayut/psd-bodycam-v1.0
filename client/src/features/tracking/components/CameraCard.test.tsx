import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/i18n/LanguageProvider';
import { signIn, signOut } from '@/test/renderPage';
import type { LiveDevice } from '../liveMerge';
import { CameraCard } from './CameraCard';

const device = (platformState: LiveDevice['platformState']): LiveDevice => ({
  id: '1',
  deviceCode: 'BC-001',
  name: 'กล้อง 1',
  lat: 13.75,
  lng: 100.5,
  speedKph: null,
  lastFixAt: new Date().toISOString(),
  platformState,
  platformStatusFetchedAt: new Date().toISOString(),
  live: false,
});

function renderCard(state: LiveDevice['platformState'], onWatch = vi.fn()) {
  render(
    <LanguageProvider>
      <MemoryRouter>
        <CameraCard
          device={device(state)}
          now={Date.now()}
          fixActiveSeconds={150}
          selected={false}
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onWatch={onWatch}
        />
      </MemoryRouter>
    </LanguageProvider>,
  );
  return onWatch;
}

describe('CameraCard ดูภาพสด', () => {
  afterEach(() => signOut());

  it('is enabled for an online camera with streaming:view-live and calls onWatch', async () => {
    signIn(['streaming:view-live']);
    const onWatch = renderCard('online');
    await userEvent.click(screen.getByRole('button', { name: 'ดูภาพสด' }));
    expect(onWatch).toHaveBeenCalledTimes(1);
  });

  it.each(['offline', 'unknown'] as const)('is shown but disabled for a %s camera', async (state) => {
    signIn(['streaming:view-live']);
    const onWatch = renderCard(state);
    const button = screen.getByRole('button', { name: 'ดูภาพสด' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onWatch).not.toHaveBeenCalled();
  });

  it('is hidden without streaming:view-live', () => {
    signIn(['tracking:view']);
    renderCard('online');
    expect(screen.queryByRole('button', { name: 'ดูภาพสด' })).not.toBeInTheDocument();
  });
});

describe('CameraCard เส้นทาง', () => {
  afterEach(() => signOut());

  it("links to today's route of this camera and sits beside ดูภาพสด", () => {
    signIn(['streaming:view-live', 'tracking:history']);
    renderCard('online');
    const link = screen.getByRole('link', { name: 'เส้นทาง' });
    const url = new URL(link.getAttribute('href') ?? '', 'http://x');
    expect(url.pathname).toBe('/tracking');
    expect(url.searchParams.get('view')).toBe('history');
    expect(url.searchParams.get('deviceId')).toBe('1');
    expect(url.searchParams.get('from')).not.toBeNull();
    expect(url.searchParams.get('to')).not.toBeNull();
    expect(link.closest('[data-slot="camera-card-actions"]')).toHaveClass('grid-cols-2');
  });

  it('is hidden without tracking:history; ดูภาพสด then takes the full width', () => {
    signIn(['streaming:view-live']);
    renderCard('online');
    expect(screen.queryByRole('link', { name: 'เส้นทาง' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ดูภาพสด' }).closest('[data-slot="camera-card-actions"]')).toHaveClass('grid-cols-1');
  });
});

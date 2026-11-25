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

describe('CameraCard ดูสด', () => {
  afterEach(() => signOut());

  it('shows for an online camera with streaming:view-live and calls onWatch', async () => {
    signIn(['streaming:view-live']);
    const onWatch = renderCard('online');
    await userEvent.click(screen.getByRole('button', { name: 'ดูสด' }));
    expect(onWatch).toHaveBeenCalledTimes(1);
  });

  it.each(['offline', 'unknown'] as const)('is hidden for a %s camera', (state) => {
    signIn(['streaming:view-live']);
    renderCard(state);
    expect(screen.queryByRole('button', { name: 'ดูสด' })).not.toBeInTheDocument();
  });

  it('is hidden without streaming:view-live', () => {
    signIn(['tracking:view']);
    renderCard('online');
    expect(screen.queryByRole('button', { name: 'ดูสด' })).not.toBeInTheDocument();
  });
});

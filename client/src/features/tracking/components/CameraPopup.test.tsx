import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/i18n/LanguageProvider';
import { signIn, signOut } from '@/test/renderPage';
import type { LiveDevice } from '../liveMerge';
import { CameraPopupContent } from './CameraPopup';

const device = (patch: Partial<LiveDevice> = {}): LiveDevice => ({
  id: '7',
  deviceCode: '1000027',
  name: 'Bodytest',
  lat: 13.845881,
  lng: 99.922681,
  speedKph: null,
  lastFixAt: new Date().toISOString(),
  platformState: 'online',
  platformStatusFetchedAt: new Date().toISOString(),
  live: false,
  ...patch,
});

function renderPopup(d: LiveDevice, onWatch: (() => void) | undefined = vi.fn()) {
  render(
    <LanguageProvider>
      <MemoryRouter>
        <CameraPopupContent device={d} now={Date.now()} fixActiveSeconds={150} onWatch={onWatch} />
      </MemoryRouter>
    </LanguageProvider>,
  );
  return onWatch;
}

describe('CameraPopupContent (marker popup)', () => {
  afterEach(() => signOut());

  it('shows name, code, status, type and coordinates', () => {
    signIn(['tracking:view']);
    renderPopup(device());
    expect(screen.getByText('Bodytest')).toBeInTheDocument();
    expect(screen.getByText('รหัส 1000027')).toBeInTheDocument();
    expect(screen.getByText('ออนไลน์')).toBeInTheDocument();
    expect(screen.getByText('Bodycam')).toBeInTheDocument();
    expect(screen.getByText('13.84588, 99.92268')).toBeInTheDocument();
  });

  it('ดูภาพสด calls onWatch for an online camera', async () => {
    signIn(['streaming:view-live']);
    const onWatch = renderPopup(device());
    await userEvent.click(screen.getByRole('button', { name: 'ดูภาพสด' }));
    expect(onWatch).toHaveBeenCalledTimes(1);
  });

  it.each(['offline', 'unknown'] as const)('ดูภาพสด is disabled for a %s camera', (platformState) => {
    signIn(['streaming:view-live']);
    renderPopup(device({ platformState }));
    expect(screen.getByRole('button', { name: 'ดูภาพสด' })).toBeDisabled();
  });

  it('ดูภาพสด is hidden without streaming:view-live', () => {
    signIn(['tracking:history']);
    renderPopup(device());
    expect(screen.queryByRole('button', { name: 'ดูภาพสด' })).not.toBeInTheDocument();
  });

  it("ดูเส้นทางวันนี้ links to today's route of this camera; hidden without tracking:history", () => {
    signIn(['tracking:history']);
    renderPopup(device());
    const link = screen.getByRole('link', { name: 'ดูเส้นทางวันนี้ของ 1000027' });
    const url = new URL(link.getAttribute('href') ?? '', 'http://x');
    expect(url.pathname).toBe('/tracking');
    expect(url.searchParams.get('view')).toBe('history');
    expect(url.searchParams.get('deviceId')).toBe('7');
    expect(url.searchParams.get('from')).not.toBeNull();
    signOut();
  });

  it('no ดูเส้นทางวันนี้ without tracking:history', () => {
    signIn(['streaming:view-live']);
    renderPopup(device());
    expect(screen.queryByRole('link', { name: /ดูเส้นทางวันนี้/ })).not.toBeInTheDocument();
  });
});

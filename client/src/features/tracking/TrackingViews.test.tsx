import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, signIn, signOut } from '@/test/renderPage';
import { TrackingRoute } from './TrackingViews';
import { historyViewHref, viewOf } from './trackingView';

vi.mock('./LiveMapPage', () => ({ LiveMapPage: () => <p>live view</p> }));
vi.mock('../tracking-history/HistoryPage', () => ({
  HistoryPage: ({ viewSwitch }: { viewSwitch?: boolean }) => <p>history view{viewSwitch ? ' with tabs' : ''}</p>,
}));

const renderAt = (url: string) =>
  renderWithProviders(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/tracking" element={<TrackingRoute />} />
      </Routes>
    </MemoryRouter>,
  );

describe('TrackingRoute (แผนที่ติดตาม tabs)', () => {
  afterEach(() => signOut());

  it.each([
    ['/tracking', 'live view'],
    ['/tracking?view=live', 'live view'],
    ['/tracking?view=history', 'history view with tabs'],
    ['/tracking?view=nonsense', 'live view'],
  ])('%s shows the %s', (url, text) => {
    signIn(['tracking:view', 'tracking:history']);
    renderAt(url);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('no tracking:history ⇒ ?view=history stays on the live map', () => {
    signIn(['tracking:view']);
    renderAt('/tracking?view=history');
    expect(screen.getByText('live view')).toBeInTheDocument();
  });
});

describe('trackingView helpers', () => {
  it('viewOf falls back on a missing or unknown value', () => {
    expect(viewOf(new URLSearchParams('view=history'), 'live')).toBe('history');
    expect(viewOf(new URLSearchParams(''), 'history')).toBe('history');
    expect(viewOf(new URLSearchParams('view=x'), 'live')).toBe('live');
  });

  it("historyViewHref opens today's route of a camera inside แผนที่ติดตาม", () => {
    const url = new URL(historyViewHref('5'), 'http://x');
    expect(url.pathname).toBe('/tracking');
    expect(url.searchParams.get('view')).toBe('history');
    expect(url.searchParams.get('deviceId')).toBe('5');
    expect(url.searchParams.get('from')).not.toBeNull();
    expect(url.searchParams.get('to')).not.toBeNull();
  });
});

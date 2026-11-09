import { render, screen } from '@testing-library/react';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageProvider } from '@/i18n/LanguageProvider';
import { th } from '@/i18n/locales/th';
import { RouteErrorPage } from './RouteErrorPage';

function Boom(): never {
  throw new Error('render failed');
}

function Shell() {
  return (
    <main>
      <Outlet />
    </main>
  );
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/broken', element: <Boom />, errorElement: <RouteErrorPage /> },
      {
        path: '/',
        element: <Shell />,
        errorElement: <RouteErrorPage />,
        children: [{ path: 'page', element: <Boom />, errorElement: <RouteErrorPage nested /> }],
      },
    ],
    { initialEntries: [path] },
  );
  return render(
    <LanguageProvider>
      <RouterProvider router={router} />
    </LanguageProvider>,
  );
}

describe('RouteErrorPage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('root-level error owns the page: a full-height main', async () => {
    renderAt('/broken');
    const title = await screen.findByText(th['common.routeError.title']);
    expect(screen.getByRole('main')).toContainElement(title);
  });

  it('child-route error inside the shell adds no second main, only a labelled section', async () => {
    renderAt('/page');
    const title = await screen.findByText(th['common.routeError.title']);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    const region = screen.getByRole('region', { name: th['common.routeError.title'] });
    expect(region.tagName).toBe('SECTION');
    expect(region).toContainElement(title);
    expect(region).not.toHaveClass('min-h-screen');
  });
});

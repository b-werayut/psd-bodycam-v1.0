import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  AsyncState,
  DataPanel,
  DataTableFrame,
  DataToolbar,
  EntitySummary,
  MetricSummary,
  PageHeader,
  StatusBadge,
  StatusStrip,
  ToolButton,
} from './index';

describe('Command Center patterns', () => {
  it('keeps icon-only operational tools large enough to acquire quickly', () => {
    render(
      <ToolButton aria-label="Refresh">
        <span aria-hidden="true">R</span>
      </ToolButton>,
    );

    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveClass('size-11');
  });

  it('gives each route one labelled page header with contextual actions', () => {
    render(
      <PageHeader
        title="Work orders"
        eyebrow="Command center"
        description="Plan and monitor field operations"
        meta={<span>Updated just now</span>}
        actions={<button type="button">Create work order</button>}
      />,
    );

    const heading = screen.getByRole('heading', { level: 1, name: 'Work orders' });
    const header = heading.closest('header');

    expect(header).toHaveAccessibleName('Work orders');
    expect(header).toHaveTextContent('Command center');
    expect(header).toHaveTextContent('Plan and monitor field operations');
    expect(header).toHaveTextContent('Updated just now');
    const action = screen.getByRole('button', { name: 'Create work order' });
    expect(action).toBeInTheDocument();
    expect(action.parentElement).toHaveClass('w-full', 'sm:w-auto');
  });

  it('announces route-level operational status with its semantic tone', () => {
    render(
      <StatusStrip tone="warning" title="Connection degraded">
        Live positions may be delayed.
      </StatusStrip>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-tone', 'warning');
    expect(alert).toHaveAttribute('data-feedback-scope', 'operational');
    expect(alert).toHaveTextContent('Connection degraded');
    expect(alert).toHaveTextContent('Live positions may be delayed.');
  });

  it('labels working panels and keeps their actions separate from content', () => {
    render(
      <DataPanel
        title="Recent events"
        description="Latest activity across the system"
        actions={<button type="button">View all</button>}
      >
        <p>Camera connected</p>
      </DataPanel>,
    );

    const panel = screen.getByRole('region', { name: 'Recent events' });
    expect(panel).toHaveClass('rounded-lg');
    expect(panel).toHaveTextContent('Latest activity across the system');
    expect(panel).toHaveTextContent('Camera connected');
    expect(screen.getByRole('button', { name: 'View all' })).toBeInTheDocument();
  });

  it('exposes metrics, statuses, and entity identity as readable content', () => {
    render(
      <>
        <MetricSummary
          label="Online cameras"
          value="118"
          detail="95.2% of fleet"
          tone="success"
        />
        <StatusBadge tone="success">Online</StatusBadge>
        <EntitySummary
          label="Selected device"
          title="BodyCam 014"
          identifier="BC-014"
          meta="Headquarters"
        />
      </>,
    );

    const metric = screen.getByRole('group', { name: 'Online cameras' });
    expect(metric).toHaveTextContent('118');
    expect(metric).toHaveClass('rounded-lg');
    expect(metric).not.toHaveClass('rounded-xl');
    expect(metric).toHaveAttribute(
      'data-tone',
      'success',
    );
    expect(metric.querySelector('p')).not.toHaveClass('uppercase');
    expect(screen.getByText('Online')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByRole('group', { name: 'Selected device' })).toHaveTextContent(
      'BodyCam 014',
    );
    expect(screen.getByRole('group', { name: 'Selected device' })).toHaveTextContent(
      'BC-014',
    );
  });

  it('gives critical metrics the shared destructive treatment', () => {
    render(
      <MetricSummary
        label="Critical events"
        value="4"
        tone="destructive"
        icon={<svg aria-hidden="true" />}
      />,
    );

    const metric = screen.getByRole('group', { name: 'Critical events' });
    expect(metric).toHaveAttribute('data-tone', 'destructive');
    expect(metric.querySelector('[data-slot="metric-icon"]')).toHaveClass(
      'text-destructive',
    );
  });

  it('renders statuses as plain dot-and-label text instead of pill badges', () => {
    render(<StatusBadge tone="success">Online</StatusBadge>);

    const status = screen.getByText('Online');
    const dot = status.firstElementChild;

    expect(status).toHaveClass('text-success');
    expect(status).not.toHaveClass('rounded-full', 'border', 'bg-success/10');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot).toHaveClass('rounded-full', 'bg-success');
  });

  it('provides labelled toolbar and table regions without adding an idle tab stop', () => {
    render(
      <>
        <DataToolbar label="Work order controls">
          <button type="button">Filter</button>
          <button type="button">Table view</button>
        </DataToolbar>
        <DataTableFrame label="Work orders" footer={<span>1–10 of 22</span>}>
          <table>
            <tbody>
              <tr>
                <td>WO-1048</td>
              </tr>
            </tbody>
          </table>
        </DataTableFrame>
      </>,
    );

    expect(screen.getByRole('toolbar', { name: 'Work order controls' })).toBeInTheDocument();
    const tableRegion = screen.getByRole('region', { name: 'Work orders' });
    expect(tableRegion).toHaveTextContent('WO-1048');
    expect(tableRegion).toHaveTextContent('1–10 of 22');
    expect(tableRegion).toHaveClass('rounded-lg');
    expect(tableRegion).not.toHaveClass('rounded-xl');
    expect(
      tableRegion.querySelector('[data-slot="horizontal-scroll-viewport"]'),
    ).not.toHaveAttribute('tabindex');
  });

  it('makes an overflowing table keyboard-scrollable and shows the remaining direction', async () => {
    render(
      <DataTableFrame label="Work orders">
        <table>
          <tbody>
            <tr>
              <td>WO-1048</td>
            </tr>
          </tbody>
        </table>
      </DataTableFrame>,
    );

    const tableRegion = screen.getByRole('region', { name: 'Work orders' });
    const viewport = tableRegion.querySelector(
      '[data-slot="horizontal-scroll-viewport"]',
    ) as HTMLElement;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 960 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    });

    fireEvent(window, new Event('resize'));

    await waitFor(() => expect(viewport).toHaveAttribute('data-overflow', 'true'));
    expect(viewport).toHaveAttribute('tabindex', '0');
    expect(viewport).toHaveAccessibleName('Work orders');
    expect(tableRegion.querySelector('[data-slot="scroll-fade-end"]')).toBeInTheDocument();
    expect(tableRegion.querySelector('[data-slot="scroll-fade-start"]')).not.toBeInTheDocument();

    Object.defineProperty(viewport, 'scrollLeft', { configurable: true, value: 120 });
    fireEvent.scroll(viewport);

    await waitFor(() =>
      expect(tableRegion.querySelector('[data-slot="scroll-fade-start"]')).toBeInTheDocument(),
    );
  });

  it('rechecks overflow when responsive table content changes', async () => {
    const { rerender } = render(
      <DataTableFrame label="Work orders">
        <table data-size="compact" />
      </DataTableFrame>,
    );
    const tableRegion = screen.getByRole('region', { name: 'Work orders' });
    const viewport = tableRegion.querySelector(
      '[data-slot="horizontal-scroll-viewport"]',
    ) as HTMLElement;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 480 },
      scrollWidth: { configurable: true, value: 480, writable: true },
      scrollLeft: { configurable: true, value: 0, writable: true },
    });
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(viewport).toHaveAttribute('data-overflow', 'false'));

    Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 1200 });
    rerender(
      <DataTableFrame label="Work orders">
        <table data-size="expanded" />
      </DataTableFrame>,
    );

    await waitFor(() => expect(viewport).toHaveAttribute('data-overflow', 'true'));
  });

  it('keeps toolbar controls compact for precise pointers without shrinking touch targets', () => {
    render(
      <DataToolbar label="Device filters">
        <input type="search" aria-label="Search devices" className="min-h-11" />
        <select aria-label="Device type" className="min-h-11">
          <option>All types</option>
        </select>
        <button type="button" className="min-h-11">Refresh</button>
      </DataToolbar>,
    );

    const toolbar = screen.getByRole('toolbar', { name: 'Device filters' });
    expect(toolbar).toHaveClass(
      'gap-2',
      '[@media(pointer:fine)]:[&_input]:h-9',
      '[@media(pointer:fine)]:[&_input]:min-h-9',
      '[@media(pointer:fine)]:[&_select]:h-9',
      '[@media(pointer:fine)]:[&_select]:min-h-9',
      '[@media(pointer:fine)]:[&_button]:h-9',
      '[@media(pointer:fine)]:[&_button]:min-h-9',
    );
    expect(screen.getByRole('searchbox', { name: 'Search devices' })).toHaveClass('min-h-11');
    expect(screen.getByRole('combobox', { name: 'Device type' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveClass('min-h-11');
  });

  it('distinguishes loading, empty, filtered-empty, and retryable errors', () => {
    const retry = vi.fn();
    const { rerender } = render(
      <AsyncState
        state="loading"
        loadingLabel="Loading work orders"
        emptyTitle="No work orders"
        filteredEmptyTitle="No matching work orders"
        errorTitle="Could not load work orders"
        retryLabel="Retry"
        onRetry={retry}
      />,
    );

    expect(screen.getByRole('status', { name: 'Loading work orders' })).toBeInTheDocument();

    rerender(
      <AsyncState
        state="empty"
        loadingLabel="Loading work orders"
        emptyTitle="No work orders"
        emptyDescription="Create the first work order to start dispatching teams."
        emptyAction={<button type="button">Create work order</button>}
        filteredEmptyTitle="No matching work orders"
        errorTitle="Could not load work orders"
        retryLabel="Retry"
        onRetry={retry}
      />,
    );
    expect(screen.getByRole('status', { name: 'No work orders' })).toBeInTheDocument();
    expect(screen.getByText('Create the first work order to start dispatching teams.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create work order' })).toBeInTheDocument();

    rerender(
      <AsyncState
        state="filtered-empty"
        loadingLabel="Loading work orders"
        emptyTitle="No work orders"
        filteredEmptyTitle="No matching work orders"
        errorTitle="Could not load work orders"
        retryLabel="Retry"
        onRetry={retry}
      />,
    );
    expect(
      screen.getByRole('status', { name: 'No matching work orders' }),
    ).toBeInTheDocument();

    rerender(
      <AsyncState
        state="error"
        loadingLabel="Loading work orders"
        emptyTitle="No work orders"
        filteredEmptyTitle="No matching work orders"
        errorTitle="Could not load work orders"
        errorDescription="Check the connection and try again."
        retryLabel="Retry"
        onRetry={retry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load work orders');
    expect(screen.getByRole('alert')).toHaveAttribute('data-feedback-scope', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

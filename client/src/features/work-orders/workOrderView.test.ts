import { describe, expect, it } from 'vitest';

import { workOrderStatusView, workWindowText } from './workOrderView';

describe('workOrderStatusView', () => {
  it('status labels and tones', () => {
    expect(workOrderStatusView(6)).toEqual({ labelKey: 'workOrders.status.planned', tone: 'info' });
    expect(workOrderStatusView(1)).toEqual({ labelKey: 'workOrders.status.open', tone: 'success' });
    expect(workOrderStatusView(2)).toEqual({ labelKey: 'workOrders.status.closed', tone: 'neutral' });
    expect(workOrderStatusView(3)).toEqual({ labelKey: 'workOrders.status.cancelled', tone: 'destructive' });
  });
});

describe('workWindowText', () => {
  it('work window: checked in, open ⇒ to now; planned ⇒ plan time', () => {
    const open = workWindowText(
      {
        status: 1,
        workWindow: { from: '2026-11-25T01:00:00.000Z', to: null },
        booking: { plannedStartAt: null },
      },
      'th',
    );
    expect(open.key).toBe('workOrders.window.actualOpen');
    expect(open.params.from).toBeTruthy();

    const done = workWindowText(
      {
        status: 2,
        workWindow: { from: '2026-11-25T01:00:00.000Z', to: '2026-11-25T03:00:00.000Z' },
        booking: { plannedStartAt: null },
      },
      'th',
    );
    expect(done.key).toBe('workOrders.window.actual');
    expect(done.params.to).toBeTruthy();

    const planned = workWindowText(
      { status: 6, workWindow: null, booking: { plannedStartAt: '2026-11-26T02:00:00.000Z' } },
      'th',
    );
    expect(planned.key).toBe('workOrders.window.planned');
    expect(planned.params.plan).toBeTruthy();

    const none = workWindowText(
      { status: 6, workWindow: null, booking: { plannedStartAt: null } },
      'th',
    );
    expect(none.key).toBe('workOrders.window.waiting');
  });

  it('a cancelled order that never checked in shows only the plan, never "not started"', () => {
    const cancelled = workWindowText(
      { status: 3, workWindow: null, booking: { plannedStartAt: '2026-11-26T02:00:00.000Z' } },
      'th',
    );
    expect(cancelled.key).toBe('workOrders.window.plannedOnly');
    expect(cancelled.params.plan).toBeTruthy();

    const cancelledNoPlan = workWindowText(
      { status: 3, workWindow: null, booking: { plannedStartAt: null } },
      'th',
    );
    expect(cancelledNoPlan).toEqual({ key: 'workOrders.window.none', params: {} });
  });

  it('a closed order without check-in / check-out times shows "—" or the plan, never "not started"', () => {
    const closedNoTimes = workWindowText(
      { status: 2, workWindow: null, booking: { plannedStartAt: null } },
      'th',
    );
    expect(closedNoTimes).toEqual({ key: 'workOrders.window.none', params: {} });

    const closedWithPlan = workWindowText(
      { status: 2, workWindow: null, booking: { plannedStartAt: '2026-11-26T02:00:00.000Z' } },
      'th',
    );
    expect(closedWithPlan.key).toBe('workOrders.window.plannedOnly');
  });

  it('a cancelled order that did check in still shows the real window', () => {
    const r = workWindowText(
      {
        status: 3,
        workWindow: { from: '2026-11-25T01:00:00.000Z', to: '2026-11-25T03:00:00.000Z' },
        booking: { plannedStartAt: '2026-11-25T00:00:00.000Z' },
      },
      'th',
    );
    expect(r.key).toBe('workOrders.window.actual');
  });
});

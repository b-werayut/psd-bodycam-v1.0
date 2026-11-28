import { afterEach, describe, expect, it, vi } from 'vitest';
import { workOrdersApi, type WorkOrderRow } from '../work-orders/workOrders.api';
import { loadCameraWorkOrders, workOrderDayRange } from './evidenceWorkOrders';

afterEach(() => vi.restoreAllMocks());

describe('evidence work orders', () => {
  it('loads every page with the selected camera filter', async () => {
    const first = { id: '1' } as WorkOrderRow;
    const second = { id: '2' } as WorkOrderRow;
    const list = vi.spyOn(workOrdersApi, 'list')
      .mockResolvedValueOnce({ data: [first], page: 1, pageSize: 100, total: 2 })
      .mockResolvedValueOnce({ data: [second], page: 2, pageSize: 100, total: 2 });
    expect(await loadCameraWorkOrders('7')).toEqual([first, second]);
    expect(list.mock.calls).toEqual([
      [{ deviceId: '7', page: 1, pageSize: 100 }],
      [{ deviceId: '7', page: 2, pageSize: 100 }],
    ]);
  });

  it('clips midnight-crossing and open-ended actual work periods to the chosen day', () => {
    const day = { from: '2026-11-24T17:00:00.000Z', to: '2026-11-25T17:00:00.000Z' };
    expect(workOrderDayRange({ workWindow: { from: '2026-11-24T16:00:00Z', to: '2026-11-24T18:00:00Z' } }, day))
      .toEqual({ startAt: day.from, endAt: '2026-11-24T18:00:00.000Z' });
    expect(workOrderDayRange({ workWindow: { from: '2026-11-25T10:00:00Z', to: null } }, day))
      .toEqual({ startAt: '2026-11-25T10:00:00.000Z', endAt: day.to });
    expect(workOrderDayRange({ workWindow: null }, day)).toBeNull();
    expect(workOrderDayRange({ workWindow: { from: day.to, to: null } }, day)).toBeNull();
    expect(workOrderDayRange({ workWindow: { from: 'invalid', to: null } }, day)).toBeNull();
  });
});

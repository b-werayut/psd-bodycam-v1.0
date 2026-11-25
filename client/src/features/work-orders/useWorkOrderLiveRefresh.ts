import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useRealtime } from '@/providers/RealtimeProvider';

const DEBOUNCE_MS = 800;

/** `workorder:changed` payload (server `WorkOrderChangedEvent`); only the id is read here. */
type WorkOrderChangedPayload = { workOrderId?: unknown };

/**
 * `workorder:changed` pushes (bursts while Booking sends jobs) refresh work-order queries once per burst.
 * Without `workOrderId` every push refreshes the list only. With it (the detail page or dialog,
 * whose GET is audited as VIEW_WORK_ORDER) only pushes for that order refresh its detail and timeline.
 */
export function useWorkOrderLiveRefresh(workOrderId?: string): void {
  const { subscribe } = useRealtime();
  const queryClient = useQueryClient();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribe<WorkOrderChangedPayload | null | undefined>('workorder:changed', (payload) => {
      if (workOrderId !== undefined && payload?.workOrderId !== workOrderId) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (workOrderId === undefined) {
          void queryClient.invalidateQueries({ queryKey: ['work-orders', 'list'] });
          return;
        }
        void queryClient.invalidateQueries({ queryKey: ['work-orders', 'detail', workOrderId] });
        void queryClient.invalidateQueries({ queryKey: ['work-orders', 'events', workOrderId] });
      }, DEBOUNCE_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [subscribe, queryClient, workOrderId]);
}

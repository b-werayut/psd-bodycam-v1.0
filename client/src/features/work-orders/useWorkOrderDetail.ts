import { useQuery } from '@tanstack/react-query';

import { useWorkOrderLiveRefresh } from './useWorkOrderLiveRefresh';
import { workOrdersApi } from './workOrders.api';

export function useWorkOrderDetail(id: string) {
  useWorkOrderLiveRefresh(id);
  return useQuery({
    queryKey: ['work-orders', 'detail', id],
    queryFn: () => workOrdersApi.detail(id),
    // Viewing a work order is audited. Refresh only after a push for this order or an explicit retry.
    retry: false,
    refetchOnWindowFocus: false,
  });
}

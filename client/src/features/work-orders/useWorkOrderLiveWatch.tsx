import { useEffect, useRef, useState, type ReactNode } from 'react';

import { LiveStreamDialog } from '@/features/streaming/components/LiveStreamDialog';
import type { WorkOrderCamera } from './workOrders.api';

type Watching = { deviceCode: string; deviceName: string | null; onlineStatus: number };

/**
 * Owner of the live dialog for work-order cameras. It must sit in a component that stays mounted while the
 * list / detail refetches (a check-out re-sorts or removes rows), or the call would hang up with the row.
 * Render `liveDialog` outside any table, tab, pagination or loading / error branch.
 */
export function useWorkOrderLiveWatch(): {
  onWatch: (camera: WorkOrderCamera & { deviceCode: string }, trigger: HTMLElement) => void;
  liveDialog: ReactNode;
} {
  const [watching, setWatching] = useState<Watching | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const open = watching !== null;
  // The live dialog unmounts on close, so hand focus back to the ดูสด button that opened it (after Radix's own cleanup).
  useEffect(() => {
    if (open) return undefined;
    const trigger = triggerRef.current;
    if (!trigger) return undefined;
    triggerRef.current = null;
    const timer = window.setTimeout(() => { if (trigger.isConnected) trigger.focus(); }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);
  const onWatch = (camera: WorkOrderCamera & { deviceCode: string }, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setWatching({ deviceCode: camera.deviceCode, deviceName: camera.name, onlineStatus: camera.platformState === 'online' ? 1 : 0 });
  };
  const liveDialog = watching ? <LiveStreamDialog device={watching} onClose={() => setWatching(null)} /> : null;
  return { onWatch, liveDialog };
}

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useRealtime } from '@/providers/RealtimeProvider';
import { devicesFromSnapshot, mergeGpsPoints, mergeSnapshot, type LiveDevice } from './liveMerge';
import { trackingApi, type GpsPoint } from './tracking.api';

const FLUSH_MS = 1000;
/** status comes only from the snapshot (DL35), so it is refreshed even while the socket is up */
const SNAPSHOT_REFRESH_MS = 60_000;
const DEFAULT_FIX_ACTIVE_SECONDS = 150;

/**
 * Live map data: the `/tracking/positions` snapshot, then `gps:batch` points queued and applied once a
 * second (one render however many batches arrive). The snapshot is refetched every minute (status and
 * cameras that stopped reporting) and at once on a reconnect; a refetch never pulls a moved marker back.
 */
export function useLivePositions() {
  const { connected, subscribe } = useRealtime();
  const query = useQuery({
    queryKey: ['tracking', 'positions'],
    queryFn: trackingApi.positions,
    refetchInterval: SNAPSHOT_REFRESH_MS,
  });
  const [devices, setDevices] = useState<LiveDevice[]>([]);
  const queue = useRef<GpsPoint[]>([]);

  useEffect(() => {
    if (query.data) {
      const snapshot = devicesFromSnapshot(query.data.data);
      setDevices((prev) => mergeSnapshot(prev, snapshot));
    }
  }, [query.data]);

  useEffect(
    () =>
      subscribe<{ points?: GpsPoint[] }>('gps:batch', (payload) => {
        if (Array.isArray(payload?.points)) queue.current.push(...payload.points);
      }),
    [subscribe],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      if (queue.current.length === 0) return;
      const points = queue.current;
      queue.current = [];
      setDevices((prev) => mergeGpsPoints(prev, points));
    }, FLUSH_MS);
    return () => clearInterval(timer);
  }, []);

  const { refetch } = query;
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) void refetch();
    wasConnected.current = connected;
  }, [connected, refetch]);

  return {
    devices,
    fixActiveSeconds: query.data?.fixActiveSeconds ?? DEFAULT_FIX_ACTIVE_SECONDS,
    isPending: query.isPending,
    isError: query.isError,
    refetch,
  };
}

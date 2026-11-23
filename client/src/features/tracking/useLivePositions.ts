import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useRealtime } from '@/providers/RealtimeProvider';
import { devicesFromSnapshot, mergeGpsPoints, type LiveDevice } from './liveMerge';
import { trackingApi, type GpsPoint } from './tracking.api';

const FLUSH_MS = 1000;
const POLL_WHILE_DISCONNECTED_MS = 60_000;
const DEFAULT_FIX_ACTIVE_SECONDS = 150;

/**
 * Live map data: the `/tracking/positions` snapshot, then `gps:batch` points queued and applied once a
 * second (one render however many batches arrive). While the socket is down the snapshot is polled every
 * minute; a reconnect fetches it again at once.
 */
export function useLivePositions() {
  const { connected, subscribe } = useRealtime();
  const query = useQuery({
    queryKey: ['tracking', 'positions'],
    queryFn: trackingApi.positions,
    refetchInterval: connected ? false : POLL_WHILE_DISCONNECTED_MS,
  });
  const [devices, setDevices] = useState<LiveDevice[]>([]);
  const queue = useRef<GpsPoint[]>([]);

  useEffect(() => {
    if (query.data) {
      queue.current = [];
      setDevices(devicesFromSnapshot(query.data.data));
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

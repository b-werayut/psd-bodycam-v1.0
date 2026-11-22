/** Minimal shape shared by the Socket.IO server (api) and the Redis emitter (worker). */
export interface BroadcastTarget {
  emit(event: string, ...args: unknown[]): void;
  to(room: string): BroadcastTarget;
  disconnectSockets?(close?: boolean): void;
}

export interface BroadcastBus {
  to(room: string): BroadcastTarget;
}

/** Redis channel prefix of the adapter (api) and emitter (worker) — both must match. */
export const REALTIME_REDIS_KEY = 'socket.io';

/** Socket.IO namespace (client `lib/realtimeUrl.ts`). */
export const REALTIME_NAMESPACE = '/realtime';

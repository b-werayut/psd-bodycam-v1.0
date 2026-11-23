// DeviceState enums (Part 4 §4.3) and the pure rules of one observation.

/** UNKNOWN is never stored: it is computed from how stale LastObservedAt is. */
export const PLATFORM_STATE = { ONLINE: 1, OFFLINE: 2 } as const;

/** 1, 3, 4 are reserved (DssDeviceList, BrmsMq, Webhook — DL30/DL32): never reuse. */
export const STATE_SOURCE = { DSS_LOCATION: 2, MANUAL: 5 } as const;

export type PlatformState = 1 | 2;

export type DisplayState = 'online' | 'offline' | 'unknown';

export function decideObservation(
  prev: { platformState: PlatformState | null },
  next: PlatformState,
): { changed: boolean; from: PlatformState | null; to: PlatformState } {
  return { changed: prev.platformState !== next, from: prev.platformState, to: next };
}

/** online / offline only while the last observation is at most `unknownAfterSeconds` old. */
export function displayStateOf(
  row: { platformState: number | null; lastObservedAt: Date | null },
  now: Date,
  unknownAfterSeconds: number,
): DisplayState {
  if (row.lastObservedAt === null || row.platformState === null) return 'unknown';
  if (now.getTime() - row.lastObservedAt.getTime() > unknownAfterSeconds * 1000) return 'unknown';
  if (row.platformState === PLATFORM_STATE.ONLINE) return 'online';
  if (row.platformState === PLATFORM_STATE.OFFLINE) return 'offline';
  return 'unknown';
}

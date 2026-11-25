import type { StatusTone } from '@/components/command-center';

export type DeviceDisplayState = 'online' | 'offline' | 'unknown';

/** Camera connectivity follows Internal-BodyCam's semantic badge colors. */
export function deviceStateTone(state: DeviceDisplayState): StatusTone {
  if (state === 'online') return 'success';
  if (state === 'offline') return 'destructive';
  return 'neutral';
}

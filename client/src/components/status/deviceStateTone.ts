import type { StatusTone } from '@/components/command-center';

export type DeviceDisplayState = 'online' | 'offline' | 'unknown';

/** Camera status → badge tone (Part 6 status→tone). StatusTone has no `unknown`, so unknown = warning. */
export function deviceStateTone(state: DeviceDisplayState): StatusTone {
  if (state === 'online') return 'success';
  if (state === 'offline') return 'neutral';
  return 'warning';
}

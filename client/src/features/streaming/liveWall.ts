import type { TranslationKey } from '@/i18n/locales/th';
import type { TranslationParams } from '@/i18n/types';
import type { LiveTarget } from './livePlayer';
import type { WallDevice } from './streaming.api';

export const LIVE_WALL_LAYOUTS = [1, 4, 6, 9, 16] as const;
export type WallSlots = ReadonlyArray<string | null>;

export function slotsFromParams(params: URLSearchParams): (string | null)[] {
  const values = params.getAll('c');
  const seen = new Set<string>();
  if (values.length === 0) return Array(6).fill(null) as null[];
  return values.slice(0, 16).map((value) => {
    const code = value.trim();
    if (!code || seen.has(code)) return null;
    seen.add(code);
    return code;
  });
}

export function paramsWithSlots(params: URLSearchParams, slots: WallSlots): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('c');
  for (const code of slots) next.append('c', code ?? '');
  return next;
}

export function withSlot(slots: WallSlots, index: number, code: string | null): (string | null)[] {
  return slots.map((current, slot) => slot === index ? code : current);
}

export function withCameraPlaced(slots: WallSlots, index: number, code: string): (string | null)[] {
  const from = slots.indexOf(code);
  const next = [...slots];
  if (from !== -1 && from !== index) next[from] = slots[index] ?? null;
  next[index] = code;
  return next;
}

export function withLayout(slots: WallSlots, count: number): (string | null)[] {
  return Array.from({ length: count }, (_, index) => slots[index] ?? null);
}

export function nextEmptySlot(slots: WallSlots, after: number): number {
  for (let step = 1; step <= slots.length; step += 1) {
    const index = (after + step) % slots.length;
    if (!slots[index]) return index;
  }
  return -1;
}

export function gridShapeFor(count: number): { columns: number; rows: number } {
  const columns = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  return { columns, rows: Math.max(1, Math.ceil(count / columns)) };
}

export function layoutBlocker(count: number, limit: number | undefined): { key: TranslationKey; params: TranslationParams } | null {
  return limit !== undefined && count > limit ? { key: 'liveWall.layout.quota', params: { limit } } : null;
}

export function wallCameraBlocker(device: WallDevice): TranslationKey | null {
  if (device.status === 4) return 'streaming.blocked.retired';
  if (!device.streamingEnabled) return 'streaming.blocked.disabled';
  if (device.platformState === 'offline') return 'liveWall.blocked.offline';
  if (device.platformState === 'unknown') return 'liveWall.blocked.unknown';
  return null;
}

export type WallSlotState =
  | { kind: 'empty' }
  | { kind: 'loading'; code: string }
  | { kind: 'missing'; code: string }
  | { kind: 'blocked'; code: string; device: WallDevice; reason: TranslationKey }
  | { kind: 'offline'; code: string; device: WallDevice; status: 'offline' | 'unknown' }
  | { kind: 'ready'; code: string; device: WallDevice; target: LiveTarget };

export function wallSlotState(code: string | null, devices: readonly WallDevice[] | undefined): WallSlotState {
  if (!code) return { kind: 'empty' };
  if (!devices) return { kind: 'loading', code };
  const device = devices.find((row) => row.deviceCode === code);
  if (!device) return { kind: 'missing', code };
  const reason = wallCameraBlocker(device);
  if (device.status === 4 || !device.streamingEnabled) return { kind: 'blocked', code, device, reason: reason! };
  if (device.platformState !== 'online') return { kind: 'offline', code, device, status: device.platformState };
  return { kind: 'ready', code, device, target: { deviceCode: code, deviceName: device.name } };
}

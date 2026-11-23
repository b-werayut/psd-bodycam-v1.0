import type { DisplayStatus } from './device-status-display.service';

export type DeviceListRow = {
  id: bigint;
  deviceCode: string;
  vendorDeviceId: string;
  name: string | null;
  model: string | null;
  serialNo: string | null;
  kind: number;
  status: number;
  streamingEnabled: boolean;
  vendorMissingSince: Date | null;
  lastFixAt: Date | null;
  lastLat: number | null;
  lastLng: number | null;
};

/** `GET /devices` row. `currentTeam` stays null until DeviceAssignments (P3a). */
export type DeviceView = {
  id: string;
  deviceCode: string;
  vendorDeviceId: string;
  name: string | null;
  model: string | null;
  serialNo: string | null;
  kind: number;
  status: number;
  streamingEnabled: boolean;
  vendorMissingSince: string | null;
  platformState: DisplayStatus['platformState'];
  platformStatusFetchedAt: string | null;
  lastFixAt: string | null;
  lastLat: number | null;
  lastLng: number | null;
  currentTeam: null;
};

export function toDeviceView(row: DeviceListRow, status: DisplayStatus | undefined): DeviceView {
  return {
    id: String(row.id),
    deviceCode: row.deviceCode,
    vendorDeviceId: row.vendorDeviceId,
    name: row.name,
    model: row.model,
    serialNo: row.serialNo,
    kind: row.kind,
    status: row.status,
    streamingEnabled: row.streamingEnabled,
    vendorMissingSince: row.vendorMissingSince?.toISOString() ?? null,
    platformState: status?.platformState ?? 'unknown',
    platformStatusFetchedAt: status?.platformStatusFetchedAt ?? null,
    lastFixAt: row.lastFixAt?.toISOString() ?? null,
    lastLat: row.lastLat,
    lastLng: row.lastLng,
    currentTeam: null,
  };
}

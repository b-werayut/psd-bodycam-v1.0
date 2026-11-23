import type { DeviceDisplayState } from '@/components/status/deviceStateTone';
import { api } from '@/lib/apiClient';

/** `GET /tracking/positions` row: last fix (from DeviceState) + screen status (DSS, cached — DL45). */
export type PositionRow = {
  deviceId: string;
  deviceCode: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
  speedKph: number | null;
  heading: number | null;
  lastFixAt: string | null;
  fixValid: boolean | null;
  platformState: DeviceDisplayState;
  /** null = DSS could not be asked; the status is the system's last known one */
  platformStatusFetchedAt: string | null;
};

export type PositionsResponse = {
  data: PositionRow[];
  total: number;
  /** a fix older than this is drawn dimmed (server: unknown-after + 2 × poll) */
  fixActiveSeconds: number;
};

/** One point of the `gps:batch` event (valid points only). */
export type GpsPoint = {
  deviceId: string;
  lat: number;
  lng: number;
  speedKph: number | null;
  heading: number | null;
  recordedAt: string;
  isValidFix: boolean;
};

export const trackingApi = {
  positions: () => api.get<PositionsResponse>('/tracking/positions').then((r) => r.data),
};

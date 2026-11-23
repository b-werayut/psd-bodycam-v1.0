import { api } from '@/lib/apiClient';
import type { Paged } from '@/lib/paged';

export type LatLng = { lat: number; lng: number };

export type RouteStop = {
  kind: 'stop';
  index: number;
  startAt: string;
  endAt: string;
  seconds: number;
  lat: number;
  lng: number;
  noSignalSeconds: number;
};

export type RouteGap = { kind: 'gap'; startAt: string; endAt: string; seconds: number; from: LatLng; to: LatLng };

export type RouteTimelineItem = RouteStop | RouteGap;

/** `GET /tracking/devices/:id/history` */
export type RouteHistory = {
  device: { id: string; code: string; name: string | null };
  from: string;
  to: string;
  rules: { stopRadiusM: number; stopMinMinutes: number; gapSeconds: number };
  pointCount: number;
  suspectCount: number;
  staleStartCount: number;
  spikeCount: number;
  smoothedCount: number;
  truncated: boolean;
  start: (LatLng & { at: string }) | null;
  end: (LatLng & { at: string }) | null;
  segments: Array<Array<[number, number]>>;
  gaps: RouteGap[];
  timeline: RouteTimelineItem[];
};

export type CameraOption = { id: string; deviceCode: string; name: string | null };

export const historyApi = {
  /** camera picker: every camera, page by page (the list endpoint caps pageSize at 100) */
  devices: async (): Promise<CameraOption[]> => {
    const out: CameraOption[] = [];
    for (let page = 1; ; page++) {
      const { data } = await api.get<Paged<CameraOption>>('/devices', { params: { page, pageSize: 100 } });
      out.push(...data.data.map((d) => ({ id: d.id, deviceCode: d.deviceCode, name: d.name })));
      if (data.data.length === 0 || out.length >= data.total) return out;
    }
  },
  history: (deviceId: string, from: string, to: string): Promise<RouteHistory> =>
    api
      .get<RouteHistory>(`/tracking/devices/${encodeURIComponent(deviceId)}/history`, { params: { from, to } })
      .then((r) => r.data),
};

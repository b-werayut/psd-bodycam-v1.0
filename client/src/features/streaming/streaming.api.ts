import { api } from '@/lib/apiClient';
import type { Paged } from '@/lib/paged';

export type WallDevice = {
  id: string;
  deviceCode: string;
  name: string | null;
  platformState: 'online' | 'offline' | 'unknown';
  platformStatusFetchedAt?: string | null;
  status: number;
  streamingEnabled: boolean;
};

export const STREAM_STATUS = { REQUESTED: 1, ACTIVE: 2, ENDED: 3, FAILED: 4 } as const;
export const STREAM_END_REASON = { USER_STOPPED: 1, EXPIRED: 2, VENDOR_ERROR: 3, POLICY_DISABLED: 4 } as const;

export type LiveSession = {
  sessionToken: string;
  protocol: number;
  device: { id: string; deviceCode: string; deviceName: string | null };
  channel: number;
  playbackUrl: string;
  idleTimeoutSeconds: number;
};
export type StreamSessionRow = {
  sessionToken: string; deviceId: string; status: number; channel: number; protocol: number;
  requestedAt: string; startedAt: string | null; lastAccessAt: string | null; endedAt: string | null;
  durationSeconds: number | null; endReason: number | null; errorMessage: string | null;
};
export type StreamStatusEvent = Pick<StreamSessionRow, 'sessionToken' | 'deviceId' | 'status'> & { endReason?: number | null };

export const streamingApi = {
  devices: async (): Promise<WallDevice[]> => {
    const devices: WallDevice[] = [];
    for (let page = 1; ; page += 1) {
      const { data } = await api.get<Paged<WallDevice>>('/devices', { params: { page, pageSize: 100 } });
      devices.push(...data.data);
      if (data.data.length === 0 || devices.length >= data.total) return devices;
    }
  },
  startLive: (payload: { DeviceCode: string; Channel?: number }) =>
    api.post<LiveSession>('/streams/live', { deviceCode: payload.DeviceCode, channel: payload.Channel ?? 1 }).then((response) => response.data),
  startPlayback: (payload: { DeviceCode: string; StartAt: string; EndAt: string; Channel?: number }) =>
    api.post<LiveSession>('/streams/playback', { deviceCode: payload.DeviceCode, startAt: payload.StartAt, endAt: payload.EndAt, channel: payload.Channel ?? 1 }).then((response) => response.data),
  stopLive: (token: string) => api.post<{ success: boolean }>(`/streams/${encodeURIComponent(token)}/stop`).then((response) => response.data),
  mySessions: () => api.get<{ data: StreamSessionRow[]; limit: number }>('/streams/sessions').then((response) => response.data),
};

import { api, API_BASE } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';

/** close code ของ `/api/talk/ws` (ชุดเดียวกันทั้งสองทอด — spec หัวข้อ "รูปแบบข้อความบน WebSocket") */
export const TALK_CLOSE_CODE = {
  NORMAL: 1000,
  NETWORK: 1006,
  FRAME: 1008,
  MAX_DURATION: 4001,
  IDLE: 4002,
  VENDOR_ENDED: 4003,
  STOPPED: 4004,
  VENDOR_ERROR: 4005,
  POLICY: 4006,
  TICKET: 4401,
} as const;

/**
 * POST start ตอบหลัง server ต่อช่องเสียงกับ DSS เสร็จ (~11 วินาที · แย่สุด ~25 วินาที)
 * — `apiClient` ไม่มี timeout รวม จึงกำหนดราย request · ต้องมากกว่า start timeout ฝั่ง server (30 วินาที)
 * เพื่อให้ client ได้ talkSessionId กลับมาก่อนเสมอ (ไม่งั้นแถวที่ server เปิดไว้จะค้างโดย client ไม่รู้ id)
 */
export const TALK_START_TIMEOUT_MS = 35_000;

export type TalkStartResponse = {
  talkSessionId: string;
  wsUrl: string;
  uplinkSampleRate: number;
  downlinkSampleRate: number;
  frameMs: number;
  maxSeconds: number;
};

export type TalkStopResponse = {
  talkSessionId: string;
  status: number;
  endReason: number | null;
  durationSeconds: number | null;
};

export const talkApi = {
  start: (streamSessionToken: string) =>
    api
      .post<TalkStartResponse>(
        '/talk/sessions',
        { streamSessionToken },
        { timeout: TALK_START_TIMEOUT_MS },
      )
      .then((r) => r.data),
  stop: (talkSessionId: string) =>
    api.post<TalkStopResponse>(`/talk/sessions/${talkSessionId}/stop`).then((r) => r.data),
  /**
   * ใช้ตอน dialog unmount / `pagehide` — request ของ axios ถูกยกเลิกเมื่อหน้าถูกปิด แต่ `fetch`
   * แบบ `keepalive` ยังไปถึง server · ทำให้ดีที่สุดเท่านั้น (ไม่ถึงก็มี relay / `TalkIdle` ปิดซ้ำที่ server)
   */
  stopOnUnload: (talkSessionId: string): void => {
    const token = useAuthStore.getState().accessToken;
    void fetch(`${api.defaults.baseURL ?? '/api'}/talk/sessions/${talkSessionId}/stop`, {
      method: 'POST',
      keepalive: true,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => undefined);
  },
};

/**
 * `wsUrl` จาก server เป็น path (`/api/talk/ws?ticket=…`) — ประกอบเป็น URL เต็มของ WebSocket
 * - API อยู่ origin เดียวกัน (ค่าเริ่มต้น `/api`) = host ของหน้าเว็บ · หน้า https ต้องเป็น wss
 * - `VITE_API_BASE` เป็น URL เต็ม (API คนละโดเมน) = origin ของ API แบบเดียวกับ `realtimeTarget()`
 */
export function talkWsUrlFor(
  wsUrl: string,
  apiBase: string | undefined = API_BASE,
  page: Pick<Location, 'protocol' | 'host'> = window.location,
): string {
  const base = (apiBase ?? '').trim();
  let origin = `${page.protocol === 'https:' ? 'wss:' : 'ws:'}//${page.host}`;
  if (base && !base.startsWith('/')) {
    try {
      const target = new URL(base);
      origin = `${target.protocol === 'https:' ? 'wss:' : 'ws:'}//${target.host}`;
    } catch {
      // แกะไม่ออก = ใช้ origin ของหน้าเว็บ (แบบเดียวกับ realtimeTarget)
    }
  }
  return origin + wsUrl;
}

export function openTalkSocket(wsUrl: string): WebSocket {
  const socket = new WebSocket(talkWsUrlFor(wsUrl));
  socket.binaryType = 'arraybuffer';
  return socket;
}

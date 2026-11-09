import { io, Socket } from 'socket.io-client';

import { realtimeTarget } from './realtimeUrl';

/**
 * ข้อความ `connect_error` เมื่อ server ปฏิเสธ token ที่ handshake (ตรงกับ `REALTIME_UNAUTHORIZED` ฝั่ง server)
 * ⚠️ socket.io ไม่ต่อใหม่เองหลังถูกปฏิเสธแบบนี้ — ต้อง refresh token แล้ว `socket.connect()` เอง
 */
export const REALTIME_UNAUTHORIZED = 'unauthorized';

export function connectRealtime(getToken: () => string | null): Socket {
  return io(realtimeTarget(import.meta.env.VITE_API_BASE as string | undefined), {
    auth: (cb: (data: { token: string }) => void) => cb({ token: getToken() ?? '' }),
    transports: ['websocket'],
  });
}

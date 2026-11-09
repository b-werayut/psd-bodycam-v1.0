import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Socket } from 'socket.io-client';

import { connectRealtime, REALTIME_UNAUTHORIZED } from '@/lib/socket';
import { refreshToken, resetRefreshState } from '@/lib/apiClient';
import { resetQueryCache } from '@/lib/queryClient';
import { shouldSignOutWeb } from '@/features/auth/sessionRevoked';
import { useAuthStore } from '@/stores/authStore';

export type RealtimeSubscribe = <T = unknown>(
  event: string,
  listener: (payload: T) => void,
) => () => void;

export type RealtimeContextValue = {
  connected: boolean;
  subscribe: RealtimeSubscribe;
};

const idleSubscribe: RealtimeSubscribe = () => () => undefined;
const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  subscribe: idleSubscribe,
});

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const hasToken = Boolean(useAuthStore((state) => state.accessToken));
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!hasToken) {
      setSocket(null);
      setConnected(false);
      return;
    }

    const nextSocket = connectRealtime(() => useAuthStore.getState().accessToken);
    let disposed = false;
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    // เน็ตหลุด = socket.io ลองต่อใหม่เองด้วย token ล่าสุด (auth เป็นฟังก์ชัน) -> ไม่ต้อง refresh
    // (refresh ทุกครั้งที่ต่อไม่ติด = ยิง /auth/refresh รัวตามรอบ reconnect ตอนเน็ตล่ม)
    // ถูกปฏิเสธ token (`unauthorized`) = socket.io เลิกลองทันที ต้อง refresh แล้วสั่ง connect() เอง
    // ไม่งั้น socket ที่ต่อใหม่ตอน token หมดอายุ realtime จะเงียบไปจนรีเฟรชหน้า
    const onConnectError = (err: unknown) => {
      const rejected = err instanceof Error && err.message === REALTIME_UNAUTHORIZED;
      if (!rejected) return;
      void refreshToken().then((token) => {
        if (token && !disposed) nextSocket.connect();
      });
    };
    // ผู้ดูแลระงับ/ปิด/ลบบัญชี -> ออกทันที ไม่ต้องรอ access token หมดอายุ (≤ 15 นาที)
    const onSessionRevoked = (payload: unknown) => {
      if (!shouldSignOutWeb(payload)) return;
      resetQueryCache();
      resetRefreshState();
      useAuthStore.getState().clear({ key: 'auth.sessionRevoked' });
    };

    nextSocket.on('connect', onConnect);
    nextSocket.on('disconnect', onDisconnect);
    nextSocket.on('connect_error', onConnectError);
    nextSocket.on('session:revoked', onSessionRevoked);
    setSocket(nextSocket);
    setConnected(nextSocket.connected);

    return () => {
      disposed = true;
      nextSocket.off('connect', onConnect);
      nextSocket.off('disconnect', onDisconnect);
      nextSocket.off('connect_error', onConnectError);
      nextSocket.off('session:revoked', onSessionRevoked);
      nextSocket.disconnect();
    };
  }, [hasToken]);

  const subscribe = useCallback<RealtimeSubscribe>(
    (event, listener) => {
      if (!socket) return () => undefined;
      socket.on(event, listener);
      return () => {
        socket.off(event, listener);
      };
    },
    [socket],
  );

  const value = useMemo(
    () => ({ connected, subscribe }),
    [connected, subscribe],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

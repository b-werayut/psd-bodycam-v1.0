import { API_BASE } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import { streamingApi } from './streaming.api';

/**
 * stop ที่ยิงไปแล้วแต่ยังไม่ได้คำตอบ — การขอจอใหม่รอชุดนี้ก่อน
 *
 * server นับโควตาจาก session ที่ยังเปิดอยู่ ถ้าสลับกล้องตอนโควตาเต็ม (เช่นเปิดครบโควตาแล้วเปลี่ยนกล้องในจอหนึ่ง)
 * คำขอเปิดจอใหม่จะไปถึงก่อน stop ของจอเดิม แล้วได้ 429 ทุกครั้ง
 */
const pending = new Set<Promise<void>>();

/** API ที่ค้างต้องไม่ทำให้จอใหม่ค้าง "กำลังเชื่อมต่อ" ไปด้วย — เกินนี้ปล่อยให้ server ตัดสินโควตาเอง */
export const SETTLE_STOPS_CAP_MS = 5_000;

export function stopStream(token: string): Promise<void> {
  // a synchronous throw from stopLive lands in the executor and settles like a failed request
  const request = new Promise<unknown>((resolve) => resolve(streamingApi.stopLive(token))).then(
    () => undefined,
    () => undefined,
  );
  pending.add(request);
  void request.then(() => pending.delete(request));
  return request;
}

export async function settlePendingStops(capMs = SETTLE_STOPS_CAP_MS): Promise<void> {
  if (pending.size === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all([...pending]),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, capMs);
    }),
  ]);
  clearTimeout(timer);
}

/**
 * ปิดแท็บ / รีโหลด — cleanup ของ React ไม่ทำงาน และ axios ส่งคำขอต่อหลังหน้าถูกปิดไม่ได้
 * keepalive fetch ยังออกไปได้ ไม่งั้น session ค้างกินโควตาจน worker เก็บ (idle timeout)
 * ซึ่งหน้าดูหลายจอที่รีโหลดตอนเปิดครบโควตาจะเปิดจอใหม่ไม่ได้เลยหลายนาที
 */
export function stopStreamOnPageHide(token: string): void {
  const accessToken = useAuthStore.getState().accessToken;
  if (!accessToken || typeof fetch !== 'function') return;
  try {
    void fetch(`${API_BASE}/streams/${encodeURIComponent(token)}/stop`, {
      method: 'POST',
      keepalive: true,
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => undefined);
  } catch {
    // ปิดหน้าไปแล้ว ส่งไม่ได้ก็ไม่มีอะไรให้ทำ — worker เก็บ session ตาม idle timeout
  }
}

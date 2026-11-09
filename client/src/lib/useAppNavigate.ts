import { useCallback } from 'react';
import { useNavigate, type NavigateOptions, type To } from 'react-router-dom';

/**
 * `useNavigate()` ที่คืน `void` — ใช้แทนในหน้าที่สั่งเปลี่ยนหน้าแล้วไม่รอผล
 *
 * แอปนี้ใช้ data router (`createBrowserRouter`) ทำให้ `navigate()` คืน Promise จริง แต่ type เป็น
 * `void | Promise<void>` — ปล่อยลอยไว้ Sonar รุ่นใหม่ฟ้อง S9383 (Promise ไม่มีคนรับ) ส่วน `void navigate()`
 * Sonar รุ่นที่ server ใช้ฟ้อง S3735 (มองว่า union นี้ไม่ใช่ Promise) จึงรับผลไว้ที่นี่ที่เดียว
 *
 * ส่ง argument ต่อตามที่ได้รับ (ไม่เติม `undefined`) — เทสต์ที่ mock `useNavigate` เทียบจำนวน argument ด้วย
 */
export function useAppNavigate(): (to: To, options?: NavigateOptions) => void {
  const navigate = useNavigate();
  return useCallback(
    (...args: [to: To, options?: NavigateOptions]) => {
      // การเปลี่ยนหน้าที่ล้มเหลว data router แสดงผ่าน errorElement อยู่แล้ว ไม่ต้องทำอะไรเพิ่มที่นี่
      Promise.resolve(navigate(...args)).catch(() => undefined);
    },
    [navigate],
  );
}

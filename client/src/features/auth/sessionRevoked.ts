/**
 * `session:revoked` ที่ยิงเข้าห้อง `user:{id}` — **เว็บอยู่ในห้องเดียวกับมือถือของคนคนนั้น**
 * จึงได้ event ตอนผู้ดูแลเพิกถอน "เครื่องมือถือ" ด้วย
 *
 * ⚠️ ออกจากระบบเฉพาะ `scope: 'account'` เท่านั้น — ออกทุก event = ถอนมือถือที่หาย
 * แล้วเว็บที่กำลังใช้อยู่เด้งตามไปด้วย ทั้งที่การถอนเครื่องไม่ได้ตัด session เว็บ
 * ⚠️ payload รูปแบบที่ไม่รู้จัก = **ไม่ออก** — server เพิกถอน refresh token ไปแล้ว
 * ถึงพลาด event นี้ก็ยังหลุดตอน `/auth/refresh` รอบถัดไปอยู่ดี
 */
export function shouldSignOutWeb(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  return (payload as { scope?: unknown }).scope === 'account';
}

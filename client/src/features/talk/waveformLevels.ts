/**
 * ตัวเลขของแถบคลื่นเสียงใน voice pill ระหว่างคุยผ่านกล้อง (pure — ทดสอบได้โดยไม่ต้อง render)
 * ค่าตั้งต้นตาม React Bits "Voice Pill" (attack 40 ms · release 240 ms · floor 0.1)
 *
 * ระดับเสียงมาจาก `TalkSession.readLevel()` = peak ของ PCM frame ล่าสุด (0..1 เชิงเส้น ทุก ~40 ms)
 */

/** ความสูงแท่งตอนเงียบ (สัดส่วนของกล่อง) — ไม่ให้เป็น 0 เพราะจะดูเหมือนสายหลุด */
export const WAVE_FLOOR = 0.1;

/** เพิ่มแท่งใหม่เข้าประวัติทุกกี่ frame ของ requestAnimationFrame */
export const WAVE_PUSH_EVERY_FRAMES = 4;

/** เก็บประวัติไว้กี่แท่ง — เกินความกว้างกล่องได้ ส่วนที่ล้นถูกวาดทิ้งไปเอง */
export const WAVE_HISTORY_MAX = 80;

const ATTACK_MS = 40;
const RELEASE_MS = 240;
const MAX_STEP_MS = 50;
const GAIN = 1.15;

/** peak เชิงเส้น → ระดับที่ตาเห็น (เสียงพูดปกติ peak แค่ 0.05–0.4 ถ้าใช้ตรง ๆ แท่งแทบไม่ขยับ) */
export function waveLevel(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0) return 0;
  return Math.min(1, Math.sqrt(peak) * GAIN);
}

/** เข้าหาเป้าหมายแบบ exponential — ขึ้นด้วย attack ลงด้วย release */
export function stepEnvelope(current: number, target: number, dtMs: number): number {
  const tau = target > current ? ATTACK_MS : RELEASE_MS;
  const dt = Math.max(0, Math.min(dtMs, MAX_STEP_MS));
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/** ระดับ 0..1 → ความสูงแท่งเป็นสัดส่วนของกล่อง (มีพื้นขั้นต่ำ WAVE_FLOOR) */
export function barScale(level: number): number {
  const v = Math.max(0, Math.min(1, level));
  return WAVE_FLOOR + (1 - WAVE_FLOOR) * v;
}

/** ต่อระดับใหม่ท้ายประวัติ ทิ้งตัวเก่าสุดเมื่อเกิน WAVE_HISTORY_MAX */
export function pushHistory(history: readonly number[], level: number): number[] {
  const next = history.length >= WAVE_HISTORY_MAX ? history.slice(1) : history.slice();
  next.push(level);
  return next;
}

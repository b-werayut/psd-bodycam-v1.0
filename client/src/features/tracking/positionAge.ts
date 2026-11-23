import type { TranslationKey } from '@/i18n/locales/th';

/** How long ago a fix was, as an i18n key + count ("เมื่อสักครู่", "10 นาทีที่แล้ว", …). */
export function positionAge(iso: string, now: number = Date.now()): { key: TranslationKey; n: number } {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return { key: 'tracking.age.now', n: 0 };
  if (seconds < 3600) return { key: 'tracking.age.minutes', n: Math.floor(seconds / 60) };
  if (seconds < 86_400) return { key: 'tracking.age.hours', n: Math.floor(seconds / 3600) };
  return { key: 'tracking.age.days', n: Math.floor(seconds / 86_400) };
}

/** A fix older than the server's fixActiveSeconds is drawn dimmed. */
export function isStaleFix(iso: string | null, fixActiveSeconds: number, now: number = Date.now()): boolean {
  if (!iso) return true;
  return now - Date.parse(iso) > fixActiveSeconds * 1000;
}

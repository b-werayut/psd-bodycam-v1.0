import { useAuthStore } from '@/stores/authStore';

export function usePermission(
  codes: string | readonly string[],
  mode: 'all' | 'any' = 'all',
): boolean {
  const user = useAuthStore((s) => s.user);
  if (!user) return false;
  if (user.roleCode === 'ADMIN') return true;
  const list = typeof codes === 'string' ? [codes] : codes;
  const granted = new Set(user.permissions);
  const has = (c: string) => granted.has(c);
  return mode === 'any' ? list.some(has) : list.every(has);
}

import { accessForPath, canEnter } from '@/app/routeAccess';
import type { AuthUser } from '@/stores/authStore';

export type LoginDestination = {
  to: string;
  blocked: boolean;
  blockedFrom?: string;
};

const HOME = '/';

/**
 * Same-origin paths only. Browsers treat `\` like `/` and drop tab/CR/LF inside URLs, so
 * `/\evil.test` and `/<tab>/evil.test` both become the protocol-relative `//evil.test`.
 */
export function safeDestination(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/')) return HOME;
  const normalized = raw.replace(/[\t\n\r]/g, '');
  if (/^\/[/\\]/.test(normalized)) return HOME;
  return raw;
}

export function resolveLoginDestination(
  raw: string | null | undefined,
  permissions: readonly string[] | undefined,
  roleCode?: AuthUser['roleCode'],
): LoginDestination {
  const to = safeDestination(raw);
  if (to === HOME) return { to: HOME, blocked: false };

  const pathname = to.split(/[?#]/)[0];
  const access = accessForPath(pathname);
  if (!access) return { to: HOME, blocked: false };

  if (!canEnter(access, permissions, roleCode)) {
    return { to: HOME, blocked: true, blockedFrom: pathname };
  }
  return { to, blocked: false };
}

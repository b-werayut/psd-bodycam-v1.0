import type { AuthUser } from '@/stores/authStore';

export type RouteAccess = {
  anyOf: readonly string[];
  allOf?: readonly string[];
};

/** Keyed by path without a leading slash; the empty key is the dashboard. */
export const ROUTE_ACCESS = {
  '': { anyOf: ['dashboard:view'] },
  tracking: { anyOf: ['tracking:view'] },
  'tracking/history': { anyOf: ['tracking:history'] },
  'live-wall': { anyOf: ['streaming:live-wall'], allOf: ['streaming:view-live'] },
  sessions: { anyOf: ['sessions:read'] },
  'work-orders': { anyOf: ['work-orders:read'] },
  'work-orders/review': { anyOf: ['work-orders:link'] },
  'work-orders/:id': { anyOf: ['work-orders:read'] },
  'booking-jobs': { anyOf: ['booking:read'] },
  'booking-jobs/:id': { anyOf: ['booking:read'] },
  recordings: { anyOf: ['playback:view'] },
  devices: { anyOf: ['devices:read'] },
  'devices/:id': { anyOf: ['devices:read'] },
  teams: { anyOf: ['teams:read'] },
  'teams/:id': { anyOf: ['teams:read'] },
  depots: { anyOf: ['devices:read'] },
  employees: { anyOf: ['org:read'] },
  departments: { anyOf: ['org:read'] },
  users: { anyOf: ['users:read'] },
  integration: { anyOf: ['integration:view'] },
  notifications: { anyOf: ['notifications:read', 'alerts:view'] },
  'audit-logs': { anyOf: ['audit:view'] },
  settings: { anyOf: ['settings:manage'] },
} as const satisfies Record<string, RouteAccess>;

function segmentsOf(path: string): string[] {
  return path.split('/').filter(Boolean);
}

export function accessForPath(pathname: string): RouteAccess | undefined {
  const target = segmentsOf(pathname);
  if (target.length === 0) return undefined;

  let best: { score: number; access: RouteAccess } | undefined;
  for (const [pattern, access] of Object.entries(ROUTE_ACCESS) as Array<[string, RouteAccess]>) {
    const segments = segmentsOf(pattern);
    if (segments.length !== target.length) continue;

    let score = 0;
    let matched = true;
    for (let i = 0; i < segments.length; i += 1) {
      if (segments[i].startsWith(':')) continue;
      if (segments[i] !== target[i]) {
        matched = false;
        break;
      }
      score += 1;
    }

    if (matched && (!best || score > best.score)) best = { score, access };
  }
  return best?.access;
}

export function canEnter(
  access: RouteAccess,
  permissions: readonly string[] | undefined,
  roleCode?: AuthUser['roleCode'],
): boolean {
  if (roleCode === 'ADMIN') return true;
  if (!permissions) return false;
  if (access.allOf?.some((p) => !permissions.includes(p))) return false;
  return access.anyOf.some((p) => permissions.includes(p));
}

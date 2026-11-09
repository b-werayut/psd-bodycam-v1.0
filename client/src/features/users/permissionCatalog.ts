/** The 34 permission codes the matrix edits (mirrors the server catalog). */
export const PERMISSION_CATALOG = [
  'dashboard:view',
  'tracking:view',
  'tracking:history',
  'sessions:read',
  'sessions:classify',
  'work-orders:read',
  'work-orders:link',
  'work-orders:void',
  'work-orders:edit-note',
  'booking:read',
  'booking:refresh',
  'integration:view',
  'integration:manage',
  'devices:read',
  'devices:manage',
  'devices:sync',
  'teams:read',
  'teams:manage',
  'org:read',
  'org:manage',
  'users:read',
  'users:manage',
  'roles:manage',
  'streaming:view-live',
  'streaming:live-wall',
  'streaming:talk',
  'playback:view',
  'evidence:export',
  'evidence:download',
  'notifications:read',
  'alerts:view',
  'alerts:manage',
  'audit:view',
  'settings:manage',
] as const;

export type PermissionGroup = { resource: string; codes: string[] };

/** Groups the catalog by the part before `:`, keeping catalog order. */
export function groupPermissions(
  codes: readonly string[] = PERMISSION_CATALOG,
): PermissionGroup[] {
  const groups = new Map<string, string[]>();
  for (const code of codes) {
    const resource = code.split(':')[0];
    const list = groups.get(resource);
    if (list) list.push(code);
    else groups.set(resource, [code]);
  }
  return [...groups].map(([resource, list]) => ({ resource, codes: list }));
}

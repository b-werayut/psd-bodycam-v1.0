// Permission catalog — Part 5 §5.7 (DL53: exactly 24 codes).
// Roles, permissions and role grants reach the DB only through data migrations
// (drizzle/0003_reference_data.sql); reference-data.int-test.ts keeps the two in sync.
// TEAM_LEADER and scope `team` arrive in P5.

export const ROLE_CODES = ['ADMIN', 'COMPANY_ADMIN', 'OPERATOR', 'VIEWER'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const ROLE_NAMES_TH: Record<RoleCode, string> = {
  ADMIN: 'ผู้ดูแลระบบ',
  COMPANY_ADMIN: 'ผู้ดูแลบริษัท',
  OPERATOR: 'ผู้ปฏิบัติการ',
  VIEWER: 'ผู้ดูข้อมูล',
};

export const PERMISSION_CODES = [
  'dashboard:view',
  'tracking:view',
  'tracking:history',
  'work-orders:read',
  'work-orders:edit-note',
  'booking:read',
  'booking:refresh',
  'devices:read',
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
export type PermissionCode = (typeof PERMISSION_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(PERMISSION_CODES);

export function isPermissionCode(value: string): value is PermissionCode {
  return CODE_SET.has(value);
}

/** Only ADMIN may hold these (DL51, DL53). Granting them to another role ⇒ 400 PERMISSION_RESERVED_FOR_ADMIN. */
export const RESERVED_ADMIN_PERMISSIONS: readonly PermissionCode[] = [
  'audit:view',
  'settings:manage',
  'roles:manage',
];

const OPERATOR_PERMISSIONS: readonly PermissionCode[] = [
  'dashboard:view',
  'tracking:view',
  'tracking:history',
  'work-orders:read',
  'work-orders:edit-note',
  'booking:read',
  'booking:refresh',
  'devices:read',
  'org:read',
  'streaming:view-live',
  'streaming:live-wall',
  'streaming:talk',
  'playback:view',
  'evidence:export',
  'evidence:download',
  'notifications:read',
  'alerts:view',
  'alerts:manage',
];

/** Default grants per role, in catalog order. */
export const ROLE_PERMISSIONS: Record<RoleCode, readonly PermissionCode[]> = {
  ADMIN: PERMISSION_CODES,
  COMPANY_ADMIN: PERMISSION_CODES.filter(
    (p) => OPERATOR_PERMISSIONS.includes(p) || p === 'org:manage' || p === 'users:read' || p === 'users:manage',
  ),
  OPERATOR: OPERATOR_PERMISSIONS,
  VIEWER: [
    'dashboard:view',
    'tracking:view',
    'tracking:history',
    'work-orders:read',
    'booking:read',
    'devices:read',
    'org:read',
    'notifications:read',
    'alerts:view',
  ],
};

export const ROLE_SCOPE: Record<RoleCode, 'all'> = {
  ADMIN: 'all',
  COMPANY_ADMIN: 'all',
  OPERATOR: 'all',
  VIEWER: 'all',
};

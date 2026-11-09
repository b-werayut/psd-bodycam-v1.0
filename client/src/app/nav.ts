import {
  Activity,
  Bell,
  Building2,
  CalendarCheck,
  Camera,
  ClipboardList,
  IdCard,
  LayoutDashboard,
  ListChecks,
  Map,
  MapPin,
  MonitorPlay,
  Plug,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';

import type { TranslationKey } from '@/i18n/locales/th';
import type { AuthUser } from '@/stores/authStore';

export type NavGroupId = 'overview' | 'operations' | 'assets' | 'system';

export type NavItem = {
  labelKey: TranslationKey;
  icon: LucideIcon;
  group: NavGroupId;
  to?: string;
  permissions: string[];
  allPermissions?: string[];
  end?: boolean;
};

export const NAV_GROUPS: ReadonlyArray<{ id: NavGroupId; labelKey: TranslationKey }> = [
  { id: 'overview', labelKey: 'navigation.group.overview' },
  { id: 'operations', labelKey: 'navigation.group.operations' },
  { id: 'assets', labelKey: 'navigation.group.assets' },
  { id: 'system', labelKey: 'navigation.group.system' },
];

// P0: only items with `to` have a route; the rest render disabled until their phase adds one.
export const NAV_ITEMS: NavItem[] = [
  { labelKey: 'navigation.dashboard', icon: LayoutDashboard, group: 'overview', to: '/', permissions: ['dashboard:view'], end: true },
  { labelKey: 'navigation.tracking', icon: Map, group: 'overview', permissions: ['tracking:view'] },
  { labelKey: 'navigation.trackingHistory', icon: Route, group: 'overview', permissions: ['tracking:history'] },
  { labelKey: 'navigation.liveWall', icon: MonitorPlay, group: 'overview', permissions: ['streaming:live-wall'], allPermissions: ['streaming:view-live'] },
  { labelKey: 'navigation.sessions', icon: Activity, group: 'operations', permissions: ['sessions:read'] },
  { labelKey: 'navigation.workOrders', icon: ClipboardList, group: 'operations', permissions: ['work-orders:read'] },
  { labelKey: 'navigation.reviewQueue', icon: ListChecks, group: 'operations', permissions: ['work-orders:link'] },
  { labelKey: 'navigation.bookingJobs', icon: CalendarCheck, group: 'operations', permissions: ['booking:read'] },
  { labelKey: 'navigation.recordings', icon: Video, group: 'operations', permissions: ['playback:view'] },
  { labelKey: 'navigation.devices', icon: Camera, group: 'assets', permissions: ['devices:read'] },
  { labelKey: 'navigation.teams', icon: Users, group: 'assets', permissions: ['teams:read'] },
  { labelKey: 'navigation.employees', icon: IdCard, group: 'assets', to: '/employees', permissions: ['org:read'] },
  { labelKey: 'navigation.departments', icon: Building2, group: 'assets', to: '/departments', permissions: ['org:read'] },
  { labelKey: 'navigation.depots', icon: MapPin, group: 'assets', permissions: ['devices:read'] },
  { labelKey: 'navigation.integration', icon: Plug, group: 'system', permissions: ['integration:view'] },
  { labelKey: 'navigation.notifications', icon: Bell, group: 'system', permissions: ['notifications:read', 'alerts:view'] },
  { labelKey: 'navigation.audit', icon: ScrollText, group: 'system', to: '/audit-logs', permissions: ['audit:view'] },
  { labelKey: 'navigation.users', icon: ShieldCheck, group: 'system', to: '/users', permissions: ['users:read'] },
  { labelKey: 'navigation.settings', icon: Settings, group: 'system', to: '/settings', permissions: ['settings:manage'] },
];

export function canSee(
  item: NavItem,
  permissions: readonly string[] | undefined,
  roleCode?: AuthUser['roleCode'],
): boolean {
  if (roleCode === 'ADMIN') return true;
  if (!permissions) return false;
  if (item.allPermissions?.some((p) => !permissions.includes(p))) return false;
  return item.permissions.some((p) => permissions.includes(p));
}

export function visibleNavItems(
  permissions: readonly string[] | undefined,
  roleCode?: AuthUser['roleCode'],
): NavItem[] {
  return NAV_ITEMS.filter((item) => canSee(item, permissions, roleCode));
}

/** Mirrors NavLink active rule: case-insensitive; end = exact path (trailing slash ok), otherwise the path or its children. */
export function isNavItemActive(item: Pick<NavItem, 'to' | 'end'>, pathname: string): boolean {
  if (!item.to) return false;
  const to = item.to.toLowerCase();
  const path = pathname.toLowerCase();
  if (path === to) return true;
  if (item.end) return path === `${to.replace(/\/$/, '')}/`;
  if (!path.startsWith(to)) return false;
  return to.endsWith('/') || path.charAt(to.length) === '/';
}

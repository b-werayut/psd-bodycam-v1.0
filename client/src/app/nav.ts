import {
  Bell,
  ClipboardList,
  History,
  LayoutDashboard,
  Map,
  MonitorPlay,
  Route,
  Settings,
  UserSearch,
  UsersRound,
  Video,
  type LucideIcon,
} from 'lucide-react';

import type { TranslationKey } from '@/i18n/locales/th';
import type { AuthUser } from '@/stores/authStore';

export type NavGroupId = 'overview' | 'operations' | 'people' | 'system';

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
  { id: 'people', labelKey: 'navigation.group.people' },
  { id: 'system', labelKey: 'navigation.group.system' },
];

// Items without `to` render disabled until their phase adds a route.
export const NAV_ITEMS: NavItem[] = [
  { labelKey: 'navigation.dashboard', icon: LayoutDashboard, group: 'overview', to: '/', permissions: ['dashboard:view'], end: true },
  { labelKey: 'navigation.liveWall', icon: MonitorPlay, group: 'operations', to: '/live-wall', permissions: ['streaming:live-wall'], allPermissions: ['streaming:view-live'] },
  { labelKey: 'navigation.workOrders', icon: ClipboardList, group: 'operations', to: '/work-orders', permissions: ['work-orders:read'] },
  { labelKey: 'navigation.playback', icon: Video, group: 'operations', permissions: ['playback:view'], allPermissions: ['work-orders:read'] },
  { labelKey: 'navigation.tracking', icon: Map, group: 'operations', to: '/tracking', permissions: ['tracking:view'], end: true },
  { labelKey: 'navigation.trackingHistory', icon: Route, group: 'operations', to: '/tracking/history', permissions: ['tracking:history'] },
  { labelKey: 'navigation.users', icon: UsersRound, group: 'people', to: '/users', permissions: ['users:read'] },
  { labelKey: 'navigation.entraUsers', icon: UserSearch, group: 'people', to: '/entra-users', permissions: ['users:manage'] },
  { labelKey: 'navigation.notifications', icon: Bell, group: 'system', permissions: ['notifications:read', 'alerts:view'] },
  { labelKey: 'navigation.audit', icon: History, group: 'system', to: '/audit-logs', permissions: ['audit:view'] },
  { labelKey: 'navigation.settings', icon: Settings, group: 'system', to: '/settings', permissions: ['settings:manage'] },
];

export function canSee(
  item: NavItem,
  permissions: readonly string[] | undefined,
  roleCode?: AuthUser['roleCode'],
): boolean {
  if (roleCode === 'SUPER_ADMIN') return true;
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

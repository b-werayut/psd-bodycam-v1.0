import { describe, expect, it } from 'vitest';

import { canSee, isNavItemActive, NAV_GROUPS, NAV_ITEMS, visibleNavItems } from './nav';

const ROLE_OPERATOR_PERMS = ['dashboard:view', 'org:read', 'work-orders:read', 'tracking:view'];

describe('NAV_ITEMS', () => {
  it('has exactly 12 items in menu order', () => {
    expect(NAV_ITEMS.map((i) => i.labelKey)).toEqual([
      'navigation.dashboard',
      'navigation.liveWall',
      'navigation.workOrders',
      'navigation.playback',
      'navigation.tracking',
      'navigation.trackingHistory',
      'navigation.employees',
      'navigation.users',
      'navigation.entraUsers',
      'navigation.notifications',
      'navigation.audit',
      'navigation.settings',
    ]);
  });

  it('puts each item in its group', () => {
    const byGroup = Object.fromEntries(
      NAV_GROUPS.map((g) => [g.id, NAV_ITEMS.filter((i) => i.group === g.id).map((i) => i.labelKey)]),
    );
    expect(byGroup).toEqual({
      overview: ['navigation.dashboard'],
      operations: [
        'navigation.liveWall',
        'navigation.workOrders',
        'navigation.playback',
        'navigation.tracking',
        'navigation.trackingHistory',
      ],
      people: ['navigation.employees', 'navigation.users', 'navigation.entraUsers'],
      system: ['navigation.notifications', 'navigation.audit', 'navigation.settings'],
    });
  });

  it('only items with a built page have a route; the rest stay placeholders', () => {
    expect(NAV_ITEMS.filter((i) => i.to).map((i) => i.to)).toEqual([
      '/',
      '/employees',
      '/users',
      '/audit-logs',
      '/settings',
    ]);
  });

  it('declares the permissions of each item', () => {
    expect(
      Object.fromEntries(
        NAV_ITEMS.map((i) => [i.labelKey, { any: i.permissions, all: i.allPermissions ?? [] }]),
      ),
    ).toEqual({
      'navigation.dashboard': { any: ['dashboard:view'], all: [] },
      'navigation.liveWall': { any: ['streaming:live-wall'], all: ['streaming:view-live'] },
      'navigation.workOrders': { any: ['work-orders:read'], all: [] },
      'navigation.playback': { any: ['playback:view'], all: ['work-orders:read'] },
      'navigation.tracking': { any: ['tracking:view'], all: [] },
      'navigation.trackingHistory': { any: ['tracking:history'], all: [] },
      'navigation.employees': { any: ['org:read'], all: [] },
      'navigation.users': { any: ['users:read'], all: [] },
      'navigation.entraUsers': { any: ['users:manage'], all: [] },
      'navigation.notifications': { any: ['notifications:read', 'alerts:view'], all: [] },
      'navigation.audit': { any: ['audit:view'], all: [] },
      'navigation.settings': { any: ['settings:manage'], all: [] },
    });
  });

  it('declares four groups', () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(['overview', 'operations', 'people', 'system']);
  });
});

describe('visibleNavItems', () => {
  it('hides settings from an operator without settings:manage', () => {
    expect(
      visibleNavItems(ROLE_OPERATOR_PERMS, 'OPERATOR').some(
        (i) => i.labelKey === 'navigation.settings',
      ),
    ).toBe(false);
  });

  it('shows exactly the items matching permissions', () => {
    expect(visibleNavItems(ROLE_OPERATOR_PERMS, 'OPERATOR').map((i) => i.labelKey)).toEqual([
      'navigation.dashboard',
      'navigation.workOrders',
      'navigation.tracking',
      'navigation.employees',
    ]);
  });

  it('shows everything to ADMIN', () => {
    expect(visibleNavItems([], 'ADMIN')).toHaveLength(NAV_ITEMS.length);
  });

  it('does not bypass for COMPANY_ADMIN: it sees only what its permissions allow', () => {
    expect(visibleNavItems(['users:read'], 'COMPANY_ADMIN').map((i) => i.labelKey)).toEqual([
      'navigation.users',
    ]);
  });

  it('live wall needs both permissions', () => {
    const wall = NAV_ITEMS.find((i) => i.labelKey === 'navigation.liveWall')!;
    expect(canSee(wall, ['streaming:live-wall'], 'OPERATOR')).toBe(false);
    expect(canSee(wall, ['streaming:live-wall', 'streaming:view-live'], 'OPERATOR')).toBe(true);
  });

  it('video playback needs playback:view plus work-orders:read', () => {
    const playback = NAV_ITEMS.find((i) => i.labelKey === 'navigation.playback')!;
    expect(canSee(playback, ['playback:view'], 'OPERATOR')).toBe(false);
    expect(canSee(playback, ['work-orders:read'], 'OPERATOR')).toBe(false);
    expect(canSee(playback, ['playback:view', 'work-orders:read'], 'OPERATOR')).toBe(true);
  });

  it('notifications accept either permission', () => {
    const notifications = NAV_ITEMS.find((i) => i.labelKey === 'navigation.notifications')!;
    expect(canSee(notifications, ['alerts:view'], 'VIEWER')).toBe(true);
    expect(canSee(notifications, ['notifications:read'], 'VIEWER')).toBe(true);
  });
});

describe('isNavItemActive', () => {
  it('end items match exactly', () => {
    const home = { to: '/', end: true };
    expect(isNavItemActive(home, '/')).toBe(true);
    expect(isNavItemActive(home, '/users')).toBe(false);
  });

  it('prefix items match children but not siblings', () => {
    const users = { to: '/users' };
    expect(isNavItemActive(users, '/users/1')).toBe(true);
    expect(isNavItemActive(users, '/users-x')).toBe(false);
  });

  it('items without a route are never active', () => {
    expect(isNavItemActive({}, '/')).toBe(false);
  });
});

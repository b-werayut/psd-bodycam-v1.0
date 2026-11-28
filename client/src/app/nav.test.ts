import { describe, expect, it } from 'vitest';

import { canSee, isNavItemActive, NAV_GROUPS, NAV_ITEMS, visibleNavItems } from './nav';

const ROLE_OPERATOR_PERMS = ['dashboard:view', 'org:read', 'work-orders:read', 'tracking:view'];

describe('NAV_ITEMS', () => {
  it('has exactly 11 items in menu order', () => {
    expect(NAV_ITEMS.map((i) => i.labelKey)).toEqual([
      'navigation.dashboard',
      'navigation.liveWall',
      'navigation.workOrders',
      'navigation.tracking',
      'navigation.trackingHistory',
      'navigation.playback',
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
        'navigation.tracking',
        'navigation.trackingHistory',
        'navigation.playback',
      ],
      people: ['navigation.users', 'navigation.entraUsers'],
      system: ['navigation.notifications', 'navigation.audit', 'navigation.settings'],
    });
  });

  it('only items with a built page have a route; the rest stay placeholders', () => {
    expect(NAV_ITEMS.filter((i) => i.to).map((i) => i.to)).toEqual([
      '/',
      '/live-wall',
      '/work-orders',
      '/tracking',
      '/tracking/history',
      '/evidence',
      '/users',
      '/entra-users',
      '/audit-logs',
      '/settings',
    ]);
  });

  it('routes the Entra users menu item to /entra-users', () => {
    expect(NAV_ITEMS.find((i) => i.labelKey === 'navigation.entraUsers')?.to).toBe('/entra-users');
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
      'navigation.playback': { any: ['playback:view'], all: ['devices:read'] },
      'navigation.tracking': { any: ['tracking:view'], all: [] },
      'navigation.trackingHistory': { any: ['tracking:history'], all: [] },
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
    ]);
  });

  it('shows everything to SUPER_ADMIN', () => {
    expect(visibleNavItems([], 'SUPER_ADMIN')).toHaveLength(NAV_ITEMS.length);
  });

  it('does not bypass for ADMIN: it sees only what its permissions allow', () => {
    expect(visibleNavItems(['users:read'], 'ADMIN').map((i) => i.labelKey)).toEqual([
      'navigation.users',
    ]);
  });

  it('live wall needs both permissions', () => {
    const wall = NAV_ITEMS.find((i) => i.labelKey === 'navigation.liveWall')!;
    expect(canSee(wall, ['streaming:live-wall'], 'OPERATOR')).toBe(false);
    expect(canSee(wall, ['streaming:live-wall', 'streaming:view-live'], 'OPERATOR')).toBe(true);
  });

  it('video playback links to /evidence and needs playback:view plus devices:read', () => {
    const playback = NAV_ITEMS.find((i) => i.labelKey === 'navigation.playback')!;
    expect(playback.to).toBe('/evidence');
    expect(canSee(playback, ['playback:view'], 'OPERATOR')).toBe(false);
    expect(canSee(playback, ['devices:read'], 'OPERATOR')).toBe(false);
    expect(canSee(playback, ['playback:view', 'devices:read'], 'OPERATOR')).toBe(true);
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

describe('tracking menu (P1)', () => {
  it('แผนที่ติดตาม routes to /tracking and is not active on /tracking/history', () => {
    const tracking = NAV_ITEMS.find((i) => i.labelKey === 'navigation.tracking')!;
    expect(tracking.to).toBe('/tracking');
    expect(isNavItemActive(tracking, '/tracking')).toBe(true);
    expect(isNavItemActive(tracking, '/tracking/history')).toBe(false);
  });
});

describe('route history menu (P1)', () => {
  it('ประวัติเส้นทาง routes to /tracking/history', () => {
    expect(NAV_ITEMS.find((i) => i.labelKey === 'navigation.trackingHistory')?.to).toBe('/tracking/history');
  });
});

import { describe, expect, it } from 'vitest';

import { canSee, isNavItemActive, NAV_GROUPS, NAV_ITEMS, visibleNavItems } from './nav';

const ROLE_OPERATOR_PERMS = ['dashboard:view', 'org:read', 'sessions:read'];

describe('NAV_ITEMS', () => {
  it('has 19 items in spec order', () => {
    expect(NAV_ITEMS.map((i) => i.labelKey)).toEqual([
      'navigation.dashboard',
      'navigation.tracking',
      'navigation.trackingHistory',
      'navigation.liveWall',
      'navigation.sessions',
      'navigation.workOrders',
      'navigation.reviewQueue',
      'navigation.bookingJobs',
      'navigation.recordings',
      'navigation.devices',
      'navigation.teams',
      'navigation.employees',
      'navigation.departments',
      'navigation.depots',
      'navigation.integration',
      'navigation.notifications',
      'navigation.audit',
      'navigation.users',
      'navigation.settings',
    ]);
  });

  it('only P0 items have a route', () => {
    expect(NAV_ITEMS.filter((i) => i.to).map((i) => i.to)).toEqual([
      '/',
      '/employees',
      '/departments',
      '/audit-logs',
      '/users',
      '/settings',
    ]);
  });

  it('declares four groups', () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(['overview', 'operations', 'assets', 'system']);
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

  it('shows items matching permissions', () => {
    const keys = visibleNavItems(ROLE_OPERATOR_PERMS, 'OPERATOR').map((i) => i.labelKey);
    expect(keys).toContain('navigation.dashboard');
    expect(keys).toContain('navigation.employees');
    expect(keys).toContain('navigation.sessions');
  });

  it('shows everything to ADMIN', () => {
    expect(visibleNavItems([], 'ADMIN')).toHaveLength(NAV_ITEMS.length);
  });

  it('live wall needs both permissions', () => {
    const wall = NAV_ITEMS.find((i) => i.labelKey === 'navigation.liveWall')!;
    expect(canSee(wall, ['streaming:live-wall'], 'OPERATOR')).toBe(false);
    expect(canSee(wall, ['streaming:live-wall', 'streaming:view-live'], 'OPERATOR')).toBe(true);
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

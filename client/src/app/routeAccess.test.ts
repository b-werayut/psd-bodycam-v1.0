import { describe, expect, it } from 'vitest';

import { accessForPath, canEnter, ROUTE_ACCESS } from './routeAccess';

describe('ROUTE_ACCESS', () => {
  it('lists only the routes of the 11-item menu plus the work-order detail', () => {
    expect(Object.keys(ROUTE_ACCESS).sort()).toEqual(
      [
        '',
        'tracking',
        'tracking/history',
        'live-wall',
        'work-orders',
        'work-orders/:id',
        'evidence',
        'users',
        'entra-users',
        'notifications',
        'audit-logs',
        'settings',
      ].sort(),
    );
  });

  it('maps the dashboard to the empty key', () => {
    expect(ROUTE_ACCESS['']).toEqual({ anyOf: ['dashboard:view'] });
  });

  it('live wall needs the wall permission plus live viewing', () => {
    expect(ROUTE_ACCESS['live-wall']).toEqual({
      anyOf: ['streaming:live-wall'],
      allOf: ['streaming:view-live'],
    });
  });

  it('notifications accept either permission', () => {
    expect(ROUTE_ACCESS['notifications'].anyOf).toEqual(['notifications:read', 'alerts:view']);
  });

  it('video playback (evidence) needs playback:view plus devices:read', () => {
    expect(ROUTE_ACCESS['evidence']).toEqual({
      anyOf: ['playback:view'],
      allOf: ['devices:read'],
    });
  });

  it('people routes: users users:read, Entra users users:manage', () => {
    expect(ROUTE_ACCESS).not.toHaveProperty('employees');
    expect(ROUTE_ACCESS['users']).toEqual({ anyOf: ['users:read'] });
    expect(ROUTE_ACCESS['entra-users']).toEqual({ anyOf: ['users:manage'] });
  });
});

describe('accessForPath', () => {
  it('matches param routes', () => {
    expect(accessForPath('/work-orders/123')).toEqual(ROUTE_ACCESS['work-orders/:id']);
  });

  it('matches nested literal paths', () => {
    expect(accessForPath('/tracking/history')).toEqual(ROUTE_ACCESS['tracking/history']);
  });

  it('returns undefined for home and unknown paths', () => {
    expect(accessForPath('/')).toBeUndefined();
    expect(accessForPath('/nope')).toBeUndefined();
  });

  it('has no access entry for removed pages', () => {
    for (const path of [
      '/departments',
      '/devices',
      '/devices/1',
      '/teams',
      '/teams/1',
      '/depots',
      '/integration',
      '/sessions',
      '/recordings',
      '/booking-jobs',
      '/booking-jobs/9',
    ]) {
      expect(accessForPath(path), path).toBeUndefined();
    }
  });
});

describe('canEnter', () => {
  it('denies without a matching permission', () => {
    expect(canEnter(ROUTE_ACCESS['settings'], ['org:read'], 'OPERATOR')).toBe(false);
  });

  it('allows SUPER_ADMIN regardless of permissions', () => {
    expect(canEnter(ROUTE_ACCESS['settings'], [], 'SUPER_ADMIN')).toBe(true);
  });

  it('requires every allOf permission', () => {
    const access = ROUTE_ACCESS['live-wall'];
    expect(canEnter(access, ['streaming:live-wall'], 'OPERATOR')).toBe(false);
    expect(canEnter(access, ['streaming:live-wall', 'streaming:view-live'], 'OPERATOR')).toBe(true);
  });

  it('denies when permissions are missing', () => {
    expect(canEnter(ROUTE_ACCESS['users'], undefined, 'VIEWER')).toBe(false);
  });
});

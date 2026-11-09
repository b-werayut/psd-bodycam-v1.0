import { describe, expect, it } from 'vitest';

import { accessForPath, canEnter, ROUTE_ACCESS } from './routeAccess';

describe('ROUTE_ACCESS', () => {
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
});

describe('accessForPath', () => {
  it('matches param routes', () => {
    expect(accessForPath('/work-orders/123')).toEqual(ROUTE_ACCESS['work-orders/:id']);
  });

  it('prefers the literal segment over a param', () => {
    expect(accessForPath('/work-orders/review')).toEqual(ROUTE_ACCESS['work-orders/review']);
  });

  it('matches nested literal paths', () => {
    expect(accessForPath('/tracking/history')).toEqual(ROUTE_ACCESS['tracking/history']);
    expect(accessForPath('/booking-jobs/9')).toEqual(ROUTE_ACCESS['booking-jobs/:id']);
  });

  it('returns undefined for home and unknown paths', () => {
    expect(accessForPath('/')).toBeUndefined();
    expect(accessForPath('/nope')).toBeUndefined();
  });
});

describe('canEnter', () => {
  it('denies without a matching permission', () => {
    expect(canEnter(ROUTE_ACCESS['settings'], ['org:read'], 'OPERATOR')).toBe(false);
  });

  it('allows ADMIN regardless of permissions', () => {
    expect(canEnter(ROUTE_ACCESS['settings'], [], 'ADMIN')).toBe(true);
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

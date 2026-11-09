import { describe, expect, it } from 'vitest';

import { resolveLoginDestination, safeDestination } from './loginDestination';

describe('safeDestination', () => {
  it('rejects external and malformed targets', () => {
    expect(safeDestination(null)).toBe('/');
    expect(safeDestination('https://evil.test')).toBe('/');
    expect(safeDestination('//evil.test')).toBe('/');
    expect(safeDestination('/users')).toBe('/users');
  });

  it('rejects backslash and control-character tricks that browsers turn into //host', () => {
    expect(safeDestination('/\\evil.test')).toBe('/');
    expect(safeDestination('/\\/evil.test')).toBe('/');
    expect(safeDestination('\\\\evil.test')).toBe('/');
    expect(safeDestination('/\t/evil.test')).toBe('/');
    expect(safeDestination('/\n/evil.test')).toBe('/');
    // a backslash or `//` later in the path/query is not a host switch
    expect(safeDestination('/users\\x')).toBe('/users\\x');
    expect(safeDestination('/users?next=//x')).toBe('/users?next=//x');
  });
});

describe('resolveLoginDestination', () => {
  it('goes home when nothing was requested', () => {
    expect(resolveLoginDestination(undefined, [], 'VIEWER')).toEqual({ to: '/', blocked: false });
  });

  it('keeps an allowed destination with its query', () => {
    expect(resolveLoginDestination('/users?x=1', ['users:read'], 'VIEWER')).toEqual({
      to: '/users?x=1',
      blocked: false,
    });
  });

  it('blocks a destination the user cannot enter', () => {
    expect(
      resolveLoginDestination('/settings', ['org:read', 'dashboard:view'], 'OPERATOR'),
    ).toEqual({ to: '/', blocked: true, blockedFrom: '/settings' });
  });

  it('lets unknown paths fall back home without blocking', () => {
    expect(resolveLoginDestination('/nope', [], 'VIEWER')).toEqual({ to: '/', blocked: false });
  });

  it('admin is never blocked', () => {
    expect(resolveLoginDestination('/settings', [], 'ADMIN')).toEqual({
      to: '/settings',
      blocked: false,
    });
  });
});

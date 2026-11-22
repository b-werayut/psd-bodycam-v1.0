import { describe, expect, it } from 'vitest';
import { assertSomeLoginMethod } from './azure-ad.config';

const on = { enabled: true } as const;
const off = { enabled: false } as const;

describe('assertSomeLoginMethod (boot rule)', () => {
  it('SSO off and password login off ⇒ nobody could sign in ⇒ throw', () => {
    expect(() => assertSomeLoginMethod(off, { AUTH_PASSWORD_LOGIN_ENABLED: 'false' })).toThrow(/AUTH_PASSWORD_LOGIN_ENABLED/);
  });

  it('either method on is fine', () => {
    expect(() => assertSomeLoginMethod(on, { AUTH_PASSWORD_LOGIN_ENABLED: 'false' })).not.toThrow();
    expect(() => assertSomeLoginMethod(off, {})).not.toThrow();
  });
});

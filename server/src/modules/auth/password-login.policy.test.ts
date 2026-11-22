import { describe, expect, it } from 'vitest';
import { isPasswordLoginEnabled } from './password-login.policy';

describe('isPasswordLoginEnabled', () => {
  it('on by default', () => {
    expect(isPasswordLoginEnabled({})).toBe(true);
    expect(isPasswordLoginEnabled({ AUTH_PASSWORD_LOGIN_ENABLED: 'true' })).toBe(true);
  });

  it('off only with an explicit false', () => {
    expect(isPasswordLoginEnabled({ AUTH_PASSWORD_LOGIN_ENABLED: ' FALSE ' })).toBe(false);
    expect(isPasswordLoginEnabled({ AUTH_PASSWORD_LOGIN_ENABLED: 'no' })).toBe(true);
  });
});

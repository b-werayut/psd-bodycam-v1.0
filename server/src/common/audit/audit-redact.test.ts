import { describe, expect, it } from 'vitest';
import { redactBody } from './audit-redact';

describe('redactBody', () => {
  it('hides secrets at every level, keeps the rest', () => {
    expect(
      redactBody({
        username: 'a',
        password: 'p',
        nested: { refreshToken: 't', keep: 1, list: [{ newPassword: 'x', note: 'n' }] },
        clientSecret: 's',
        pin: '1234',
      }),
    ).toEqual({
      username: 'a',
      password: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]', keep: 1, list: [{ newPassword: '[REDACTED]', note: 'n' }] },
      clientSecret: '[REDACTED]',
      pin: '[REDACTED]',
    });
  });

  it('returns null for empty or non-object bodies', () => {
    expect(redactBody(undefined)).toBeNull();
    expect(redactBody({})).toBeNull();
    expect(redactBody('text')).toBeNull();
  });

  it('cuts very large bodies to a marker instead of storing them', () => {
    const big = { note: 'x'.repeat(5000) };
    expect(redactBody(big)).toEqual({ truncated: true, preview: expect.any(String) });
    expect(JSON.stringify(redactBody(big)).length).toBeLessThanOrEqual(4100);
  });
});

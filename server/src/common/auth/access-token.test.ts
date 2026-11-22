import { describe, expect, it } from 'vitest';
import { accessTokenSecret, signAccessToken, verifyAccessToken } from './access-token';
import type { JwtPayload } from './auth-user';

const payload: JwtPayload = {
  sub: '42',
  username: 'operator1',
  roleId: '3',
  roleCode: 'OPERATOR',
  permissions: ['dashboard:view', 'tracking:view'],
};
const env = { JWT_ACCESS_SECRET: 'x'.repeat(40) };

describe('access token', () => {
  it('signs and verifies a payload (HS256)', async () => {
    const token = await signAccessToken(payload, env);
    expect(token.split('.')).toHaveLength(3);
    expect(await verifyAccessToken(token, env)).toMatchObject(payload);
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signAccessToken(payload, { JWT_ACCESS_SECRET: 'y'.repeat(40) });
    expect(await verifyAccessToken(token, env)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signAccessToken(payload, { ...env, ACCESS_TOKEN_TTL: '1s' }, new Date(Date.now() - 60_000));
    expect(await verifyAccessToken(token, env)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await verifyAccessToken('not.a.jwt', env)).toBeNull();
  });

  it('dev without a secret uses the insecure fallback; production without one throws', () => {
    expect(accessTokenSecret({ NODE_ENV: 'development' })).toBe('dev-insecure-jwt-secret-change-me');
    expect(() => accessTokenSecret({ NODE_ENV: 'production' })).toThrow(/JWT_ACCESS_SECRET/);
  });
});

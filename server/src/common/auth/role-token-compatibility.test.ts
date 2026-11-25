import { SignJWT } from 'jose';
import { expect, it } from 'vitest';
import { verifyAccessToken } from './access-token';

it.each([
  ['SUPERADMIN', 'SUPER_ADMIN', '1'],
  ['TEAMLEADER', 'TEAM_LEADER', '5'],
])('keeps an existing %s session valid with the canonical role code', async (oldCode, canonicalCode, roleId) => {
  const secret = 'role-code-migration-test-secret';
  const token = await new SignJWT({ username: 'user', roleId, roleCode: oldCode, permissions: ['streaming:view-live'] })
    .setProtectedHeader({ alg: 'HS256' }).setSubject('7').setIssuedAt().setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
  expect(await verifyAccessToken(token, { JWT_ACCESS_SECRET: secret })).toMatchObject({
    sub: '7', roleId, roleCode: canonicalCode, permissions: ['streaming:view-live'],
  });
});

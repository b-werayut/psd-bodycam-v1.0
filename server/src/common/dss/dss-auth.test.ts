import { decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';
import { verifyDssBearer } from '../../test/dss-token';
import { dssAuthorizationHeader } from './dss-auth';

const KEY = 'test-dss-api-key-0123456789abcdef';
const OTHER_KEY = 'another-key-of-at-least-32-characters!';

describe('dssAuthorizationHeader', () => {
  it('is `Bearer <JWT>` signed with the key (HS256), aud psd-bwc-dss-services, iss bwc-nest', async () => {
    const header = await dssAuthorizationHeader(KEY);
    const payload = await verifyDssBearer(header, KEY);
    expect(payload.aud).toBe('psd-bwc-dss-services');
    expect(payload.iss).toBe('bwc-nest');
    expect(decodeProtectedHeader(header.slice('Bearer '.length))).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('lives 60 seconds from signing', async () => {
    const now = Date.parse('2026-11-11T03:00:00.400Z');
    const header = await dssAuthorizationHeader(KEY, now);
    const [, token] = header.split(' ');
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    const iat = Math.floor(Date.parse('2026-11-11T03:00:00Z') / 1000);
    expect(claims.iat).toBe(iat);
    expect(claims.exp).toBe(iat + 60);
  });

  it('never sends the key itself, and another key cannot verify it', async () => {
    const header = await dssAuthorizationHeader(KEY);
    expect(header).not.toContain(KEY);
    await expect(verifyDssBearer(header, OTHER_KEY)).rejects.toThrow(/signature/);
  });
});

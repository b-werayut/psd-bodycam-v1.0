import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type KeyLike } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppException } from '../../../common/errors/app-exception';
import type { AzureAdConfig } from './azure-ad.config';
import { EntraTokenVerifier } from './entra-token.verifier';

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const config: AzureAdConfig = {
  enabled: true,
  tenantId: TENANT,
  clientId: CLIENT,
  issuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  jwksUri: 'https://unused.invalid/keys',
  allowedEmailDomains: [],
};

let key: KeyLike;
let rogue: KeyLike;
let verifier: EntraTokenVerifier;

const sign = (over: { aud?: string; iss?: string; exp?: number; key?: KeyLike; claims?: object } = {}) =>
  new SignJWT({ oid: 'oid-1', tid: TENANT, preferred_username: 'Somchai@PSD.co.th', name: 'สมชาย', ...over.claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(over.iss ?? config.issuer)
    .setAudience(over.aud ?? CLIENT)
    .setIssuedAt()
    .setExpirationTime(over.exp ?? Math.floor(Date.now() / 1000) + 300)
    .sign(over.key ?? key);

const rejection = async (token: string) => {
  try {
    await verifier.verify(token);
  } catch (error) {
    return error as AppException;
  }
  throw new Error('expected a rejection');
};

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  key = pair.privateKey;
  rogue = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  verifier = new EntraTokenVerifier(config, createLocalJWKSet({ keys: [jwk] }));
});

describe('EntraTokenVerifier.verify', () => {
  it('a valid id_token ⇒ identity with lowercased email', async () => {
    expect(await verifier.verify(await sign())).toEqual({
      objectId: 'oid-1',
      email: 'somchai@psd.co.th',
      displayName: 'สมชาย',
    });
  });

  it('wrong audience (e.g. a Graph access token) ⇒ 401 SSO_TOKEN_INVALID', async () => {
    const error = await rejection(await sign({ aud: 'https://graph.microsoft.com' }));
    expect(error.getStatus()).toBe(401);
    expect(error.code).toBe('SSO_TOKEN_INVALID');
  });

  it('another tenant as issuer ⇒ 401', async () => {
    expect((await rejection(await sign({ iss: 'https://login.microsoftonline.com/other/v2.0' }))).getStatus()).toBe(401);
  });

  it('signed by a key outside the JWKS ⇒ 401', async () => {
    expect((await rejection(await sign({ key: rogue }))).code).toBe('SSO_TOKEN_INVALID');
  });

  it('expired more than 60 s ago ⇒ 401 with a "sign in again" message; within 60 s tolerance ⇒ ok', async () => {
    const now = Math.floor(Date.now() / 1000);
    const old = await rejection(await sign({ exp: now - 120 }));
    expect(old.message).toContain('หมดอายุ');
    await expect(verifier.verify(await sign({ exp: now - 30 }))).resolves.toBeTruthy();
  });

  it('tid of another tenant ⇒ 401', async () => {
    expect((await rejection(await sign({ claims: { tid: '99999999-2222-3333-4444-555555555555' } }))).getStatus()).toBe(401);
  });

  it('SSO turned off ⇒ 403 SSO_DISABLED', async () => {
    const off = new EntraTokenVerifier({ ...config, enabled: false });
    try {
      await off.verify('x');
      throw new Error('expected a rejection');
    } catch (error) {
      expect((error as AppException).getStatus()).toBe(403);
      expect((error as AppException).code).toBe('SSO_DISABLED');
    }
  });
});

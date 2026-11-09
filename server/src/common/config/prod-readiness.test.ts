import { describe, expect, it } from 'vitest';
import { checkProdEnv, summarizeReadiness } from './prod-readiness';

const base: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://u:p@db/app',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  CORS_ORIGINS: 'https://bwc.example',
  COOKIE_SECURE: 'true',
  COOKIE_SAMESITE: 'lax',
  TRUST_PROXY: '1',
  REDIS_URL: 'redis://r:6379',
  AZURE_AD_TENANT_ID: '00000000-0000-0000-0000-000000000001',
  AZURE_AD_CLIENT_ID: '00000000-0000-0000-0000-000000000002',
};

const level = (env: NodeJS.ProcessEnv, id: string) =>
  checkProdEnv(env).find((c) => c.id === id)?.level;

describe('checkProdEnv', () => {
  it('a ready env has no failures', () => {
    expect(summarizeReadiness(checkProdEnv(base)).fail).toBe(0);
  });

  it('fails a short JWT secret', () => {
    expect(level({ ...base, JWT_ACCESS_SECRET: 'short' }, 'JWT_ACCESS_SECRET')).toBe('fail');
  });

  it('fails wildcard and missing CORS origins', () => {
    expect(level({ ...base, CORS_ORIGINS: '*' }, 'CORS_ORIGINS')).toBe('fail');
    expect(level({ ...base, CORS_ORIGINS: '' }, 'CORS_ORIGINS')).toBe('fail');
  });

  it('warns on non-https origin, fails insecure cookie, redis, database', () => {
    expect(level({ ...base, CORS_ORIGINS: 'http://bwc.example' }, 'CORS_ORIGINS')).toBe('warn');
    expect(level({ ...base, COOKIE_SECURE: 'false' }, 'COOKIE_SECURE')).toBe('fail');
    expect(level({ ...base, REDIS_URL: '' }, 'REDIS_URL')).toBe('fail');
    expect(level({ ...base, DATABASE_URL: '' }, 'DATABASE_URL')).toBe('fail');
  });

  it('fails TRUST_PROXY=true and bad SameSite', () => {
    expect(level({ ...base, TRUST_PROXY: 'true' }, 'TRUST_PROXY')).toBe('fail');
    expect(level({ ...base, COOKIE_SAMESITE: 'bogus' }, 'COOKIE_SAMESITE')).toBe('fail');
  });

  it('fails when SEED_DEMO_PASSWORD is set in prod', () => {
    expect(level({ ...base, SEED_DEMO_PASSWORD: 'x' }, 'SEED_DEMO_PASSWORD')).toBe('fail');
    expect(checkProdEnv(base).map((c) => c.id)).not.toContain('SEED_DEMO_PASSWORD');
  });

  it('fails half-configured Azure AD', () => {
    expect(level({ ...base, AZURE_AD_CLIENT_ID: '' }, 'AZURE_AD_*')).toBe('fail');
  });

  it('includes refresh TTL checks and none of the later-phase ids', () => {
    const ids = checkProdEnv(base).map((c) => c.id);
    expect(ids).toContain('REFRESH_TOKEN_TTL_HOURS');
    expect(ids).toContain('REFRESH_TOKEN_TTL_HOURS_DEVICE');
    for (const gone of ['ROAD_MATCH_DRIVER', 'OSRM_URL', 'STORAGE_LOCAL_DIR', 'MINIO_*', 'STREAM_PROVIDER_DRIVER', 'PUSH_PROVIDER_DRIVER', 'GPS_POLL_ENABLED', 'INTEGRATION_WEBHOOK_SECRET'])
      expect(ids).not.toContain(gone);
  });

  it('warns when NODE_ENV is not production', () => {
    expect(level({ ...base, NODE_ENV: 'development' }, 'NODE_ENV')).toBe('warn');
  });
});

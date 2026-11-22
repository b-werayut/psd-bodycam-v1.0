import { describe, expect, it } from 'vitest';
import { assertSeedAllowed, seedPassword } from './dev-seed';

describe('dev seed guards', () => {
  it('refuses NODE_ENV=production', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production' })).toThrow(/production/);
  });

  it('allows development, test and unset NODE_ENV', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertSeedAllowed({})).not.toThrow();
  });

  it('uses SEED_ADMIN_PASSWORD for admin and SEED_DEMO_PASSWORD for the rest, with fallbacks', () => {
    expect(seedPassword('ADMIN', {})).toBe('Admin@12345');
    expect(seedPassword('OPERATOR', {})).toBe('Demo@12345');
    const env = { SEED_ADMIN_PASSWORD: 'a-secret', SEED_DEMO_PASSWORD: 'd-secret' };
    expect(seedPassword('ADMIN', env)).toBe('a-secret');
    expect(seedPassword('COMPANY_ADMIN', env)).toBe('d-secret');
    expect(seedPassword('VIEWER', { SEED_DEMO_PASSWORD: '  ' })).toBe('Demo@12345');
  });
});

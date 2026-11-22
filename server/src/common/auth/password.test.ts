import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('produces an argon2 hash that verifies the same password only', async () => {
    const hash = await hashPassword('Admin@12345');
    expect(hash).toMatch(/^\$argon2/);
    expect(hash).not.toContain('Admin@12345');
    expect(await verifyPassword(hash, 'Admin@12345')).toBe(true);
    expect(await verifyPassword(hash, 'admin@12345')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('returns false instead of throwing for a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

import { hash, verify } from '@node-rs/argon2';

/** argon2id with the library defaults. */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

/** false for a wrong password and for a hash that cannot be parsed. */
export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain);
  } catch {
    return false;
  }
}

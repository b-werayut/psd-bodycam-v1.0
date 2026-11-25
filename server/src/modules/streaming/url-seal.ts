import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function streamUrlKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const secret = env.STREAM_URL_SECRET || env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error('ต้องตั้ง STREAM_URL_SECRET หรือ JWT_ACCESS_SECRET ก่อนใช้ live streaming');
  }
  return createHash('sha256').update(secret).digest();
}

export function sealUrl(url: string, key: Buffer, sessionToken = ''): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(sessionToken));
  const enc = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}

export function openUrl(sealed: string, key: Buffer, sessionToken = ''): string {
  const raw = Buffer.from(sealed, 'base64url');
  if (raw.length <= IV_BYTES + TAG_BYTES) throw new Error('ข้อมูล URL ไม่ครบ');
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAAD(Buffer.from(sessionToken));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}

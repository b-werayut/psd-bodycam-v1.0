import { createHmac, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { addCidr, type BookingInboundConfig } from './booking-inbound.config';

export type InboundAuthInput = {
  headers: Record<string, string | undefined>;
  rawBody: Buffer;
  ip: string;
  nowMs: number;
};

export type InboundAuthResult =
  | { ok: true }
  | { ok: false; reason: 'not-configured' | 'cidr' | 'timestamp' | 'signature' | 'api-key' };

const MAX_SKEW_SECONDS = 300;

/** `sha256=<hex>` = HMAC-SHA256(secret, `${timestamp}.${rawBody}`) */
export function signBody(secret: string, timestamp: string, rawBody: Buffer | string): string {
  const h = createHmac('sha256', secret);
  h.update(`${timestamp}.`);
  h.update(rawBody);
  return `sha256=${h.digest('hex')}`;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Compares against every secret (no early exit) so timing does not reveal which one matched. */
function matchesAny(candidate: string, secrets: string[], expected: (secret: string) => string): boolean {
  let hit = false;
  for (const secret of secrets) {
    if (safeEqual(candidate, expected(secret))) hit = true;
  }
  return hit;
}

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function ipAllowed(ip: string, cidrs: string[]): boolean {
  const plain = ip.trim().replace(/^::ffff:/i, '');
  const family = isIP(plain);
  if (family === 0) return false;
  const list = new BlockList();
  for (const cidr of cidrs) addCidr(list, cidr);
  return list.check(plain, family === 4 ? 'ipv4' : 'ipv6');
}

export function checkInboundAuth(input: InboundAuthInput, cfg: BookingInboundConfig): InboundAuthResult {
  if (cfg.secrets.length === 0) return { ok: false, reason: 'not-configured' };

  if (cfg.allowedCidrs.length > 0 && !ipAllowed(input.ip, cfg.allowedCidrs)) {
    return { ok: false, reason: 'cidr' };
  }

  if (cfg.auth === 'api-key') {
    const key = header(input.headers, 'x-api-key');
    if (!key || !matchesAny(key, cfg.secrets, (s) => s)) return { ok: false, reason: 'api-key' };
    return { ok: true };
  }

  const timestamp = header(input.headers, 'x-booking-timestamp')?.trim();
  if (!timestamp || !/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'timestamp' };
  if (Math.abs(input.nowMs / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return { ok: false, reason: 'timestamp' };

  const signature = header(input.headers, 'x-booking-signature')?.trim();
  if (!signature || !matchesAny(signature, cfg.secrets, (s) => signBody(s, timestamp, input.rawBody))) {
    return { ok: false, reason: 'signature' };
  }
  return { ok: true };
}

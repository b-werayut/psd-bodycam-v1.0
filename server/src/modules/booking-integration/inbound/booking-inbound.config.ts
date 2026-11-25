import { BlockList, isIP } from 'node:net';

type Env = Record<string, string | undefined>;

export type BookingInboundConfig = {
  auth: 'hmac' | 'api-key';
  secrets: string[];
  allowedCidrs: string[];
  mapper: 'v1';
};

const MAX_SECRETS = 2;

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Adds `ip/prefix` (IPv4 or IPv6) to a BlockList; returns false when it is malformed. */
export function addCidr(blockList: BlockList, cidr: string): boolean {
  const m = /^([^/]+)\/(\d{1,3})$/.exec(cidr);
  if (!m) return false;
  const family = isIP(m[1]!);
  const prefix = Number(m[2]);
  if (family === 0 || prefix > (family === 4 ? 32 : 128)) return false;
  try {
    blockList.addSubnet(m[1]!, prefix, family === 4 ? 'ipv4' : 'ipv6');
    return true;
  } catch {
    return false;
  }
}

/** Reads the Booking inbound env at boot; a broken value stops the process with the env name in the message. */
export function readBookingInboundConfig(env: Env): BookingInboundConfig {
  const authRaw = (env.BOOKING_INBOUND_AUTH ?? '').trim().toLowerCase() || 'hmac';
  if (authRaw !== 'hmac' && authRaw !== 'api-key') {
    throw new Error(`env BOOKING_INBOUND_AUTH='${authRaw}' ใช้ไม่ได้ — รับเฉพาะ hmac | api-key`);
  }
  const mapperRaw = (env.BOOKING_INBOUND_MAPPER ?? '').trim().toLowerCase() || 'v1';
  if (mapperRaw !== 'v1') {
    throw new Error(`env BOOKING_INBOUND_MAPPER='${mapperRaw}' ใช้ไม่ได้ — ตอนนี้รับเฉพาะ v1`);
  }
  const secrets = list(env.BOOKING_INBOUND_SECRETS);
  if (secrets.length > MAX_SECRETS) {
    throw new Error(`env BOOKING_INBOUND_SECRETS มี ${secrets.length} ค่า — ใส่ได้ไม่เกิน ${MAX_SECRETS} (ค่าปัจจุบัน + ค่าเก่าตอน rotate)`);
  }
  const allowedCidrs = list(env.BOOKING_INBOUND_ALLOWED_CIDRS);
  const probe = new BlockList();
  for (const cidr of allowedCidrs) {
    if (!addCidr(probe, cidr)) {
      throw new Error(`env BOOKING_INBOUND_ALLOWED_CIDRS มีค่า '${cidr.slice(0, 80)}' ที่ไม่ใช่ CIDR (เช่น 10.0.0.0/8)`);
    }
  }
  return { auth: authRaw, secrets, allowedCidrs, mapper: 'v1' };
}

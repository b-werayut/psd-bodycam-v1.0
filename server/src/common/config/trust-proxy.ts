export type TrustProxyValue = number | string | string[] | false;

export type TrustProxyResolution = {
  value: TrustProxyValue;
  error?: string;
};

export const TRUST_PROXY_DEFAULT = 'loopback';

const KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);
const OFF = new Set(['off', 'false', 'none', 'no']);
const TRUST_EVERYTHING = new Set(['true', 'all', 'any', '*']);

const DANGER =
  'ทำให้ Express เชื่อ X-Forwarded-For ที่ผู้เรียกส่งมาเอง = ปลอม IP ข้าม rate limit ' +
  'และเขียนแถว AuditLogs ด้วย IP ปลอมได้';
const HOW_TO =
  "ใช้ 'loopback' (nginx เครื่องเดียวกัน), จำนวน hop เช่น '1', หรือ IP/ช่วง IP ของ proxy";

export function resolveTrustProxy(env: NodeJS.ProcessEnv): TrustProxyResolution {
  const raw = (env.TRUST_PROXY ?? '').trim();
  if (!raw) return { value: TRUST_PROXY_DEFAULT };

  const lower = raw.toLowerCase();

  if (TRUST_EVERYTHING.has(lower)) {
    return {
      value: TRUST_PROXY_DEFAULT,
      error: `TRUST_PROXY='${raw}' ใช้ไม่ได้ — ${DANGER} · ${HOW_TO} · ตอนนี้ถอยไปใช้ '${TRUST_PROXY_DEFAULT}'`,
    };
  }
  if (OFF.has(lower)) return { value: false };
  if (KEYWORDS.has(lower)) return { value: lower };

  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    if (!Number.isSafeInteger(hops)) {
      return {
        value: TRUST_PROXY_DEFAULT,
        error: `TRUST_PROXY='${raw}' เป็นจำนวนที่ใหญ่เกินใช้งาน — ${HOW_TO}`,
      };
    }
    return { value: hops };
  }

  const list = raw
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  const bad = list.filter((token) => !isTrustToken(token));
  if (list.length === 0 || bad.length > 0) {
    return {
      value: TRUST_PROXY_DEFAULT,
      error: `TRUST_PROXY มีค่าที่อ่านไม่ออก: ${bad.join(', ') || raw} — ${HOW_TO} · ตอนนี้ถอยไปใช้ '${TRUST_PROXY_DEFAULT}'`,
    };
  }
  return { value: list };
}

function isTrustToken(token: string): boolean {
  if (KEYWORDS.has(token.toLowerCase())) return true;
  const [addr, prefix, ...rest] = token.split('/');
  if (rest.length > 0) return false;
  if (prefix !== undefined && !/^\d{1,3}$/.test(prefix)) return false;
  return isIpv4(addr) || isIpv6(addr);
}

function isIpv4(addr: string): boolean {
  const parts = addr.split('.');
  return (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  );
}

function isIpv6(addr: string): boolean {
  return addr.includes(':') && /^[0-9a-fA-F:.]+$/.test(addr);
}

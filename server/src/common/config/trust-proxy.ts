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
  'makes Express trust an X-Forwarded-For header supplied by the caller = IP spoofing past the rate limit ' +
  'and AuditLogs rows written with a fake IP';
const HOW_TO =
  "use 'loopback' (nginx on the same machine), a hop count such as '1', or the proxy IP / IP range";

export function resolveTrustProxy(env: NodeJS.ProcessEnv): TrustProxyResolution {
  const raw = (env.TRUST_PROXY ?? '').trim();
  if (!raw) return { value: TRUST_PROXY_DEFAULT };

  const lower = raw.toLowerCase();

  if (TRUST_EVERYTHING.has(lower)) {
    return {
      value: TRUST_PROXY_DEFAULT,
      error: `TRUST_PROXY='${raw}' is not allowed - ${DANGER} · ${HOW_TO} · falling back to '${TRUST_PROXY_DEFAULT}'`,
    };
  }
  if (OFF.has(lower)) return { value: false };
  if (KEYWORDS.has(lower)) return { value: lower };

  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    if (!Number.isSafeInteger(hops)) {
      return {
        value: TRUST_PROXY_DEFAULT,
        error: `TRUST_PROXY='${raw}' is too large to use - ${HOW_TO}`,
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
      error: `TRUST_PROXY has unreadable values: ${bad.join(', ') || raw} - ${HOW_TO} · falling back to '${TRUST_PROXY_DEFAULT}'`,
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

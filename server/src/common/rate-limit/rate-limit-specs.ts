// Per-endpoint quotas. P0 has the auth endpoints only; later phases append names (e.g. booking-inbound).
export type RateLimitName = 'auth-login' | 'auth-sso' | 'auth-refresh' | 'booking-inbound' | 'evidence-export' | 'evidence-download';

/** `keyBy` defaults to 'ip'. 'user' counts per authenticated user (falls back to IP when no user is on the request). */
export type RateLimitSpec = { limit: number; windowSeconds: number; keyBy?: 'ip' | 'user' };

const MINUTE = 60;
const HOUR = 3600;

const SPECS: Record<RateLimitName, (env: NodeJS.ProcessEnv) => RateLimitSpec> = {
  'auth-login': (env) => ({ limit: positiveInt(env.AUTH_LOGIN_RATE_LIMIT_PER_MIN, 60), windowSeconds: MINUTE }),
  'auth-sso': (env) => ({ limit: positiveInt(env.AUTH_SSO_RATE_LIMIT_PER_MIN, 60), windowSeconds: MINUTE }),
  'auth-refresh': (env) => ({ limit: positiveInt(env.AUTH_REFRESH_RATE_LIMIT_PER_MIN, 120), windowSeconds: MINUTE }),
  'booking-inbound': (env) => ({ limit: positiveInt(env.BOOKING_INBOUND_RATE_LIMIT_PER_MIN, 600), windowSeconds: MINUTE }),
  // Each export is ffmpeg + hundreds of MB from DSS. Counted per user, so operators behind one office NAT do not share it.
  'evidence-export': (env) => ({ limit: positiveInt(env.EVIDENCE_EXPORT_RATE_LIMIT_PER_HOUR, 30), windowSeconds: HOUR, keyBy: 'user' }),
  'evidence-download': (env) => ({ limit: positiveInt(env.EVIDENCE_DOWNLOAD_RATE_LIMIT_PER_MIN, 60), windowSeconds: MINUTE }),
};

export function rateLimitSpec(name: RateLimitName, env: NodeJS.ProcessEnv): RateLimitSpec {
  return SPECS[name](env);
}

/** Auth quotas count per client IP (`req.ip`, so TRUST_PROXY must match the proxy chain). */
export function rateLimitKey(name: RateLimitName, ip: string | undefined, userId?: bigint): string {
  if (userId !== undefined) return `${name}:user:${userId}`;
  return `${name}:ip:${ip || 'unknown'}`;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number((raw ?? '').trim());
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

// Per-endpoint quotas. P0 has the auth endpoints only; later phases append names (e.g. booking-inbound).
export type RateLimitName = 'auth-login' | 'auth-sso' | 'auth-refresh';

export type RateLimitSpec = { limit: number; windowSeconds: number };

const MINUTE = 60;

const SPECS: Record<RateLimitName, (env: NodeJS.ProcessEnv) => RateLimitSpec> = {
  'auth-login': (env) => ({ limit: positiveInt(env.AUTH_LOGIN_RATE_LIMIT_PER_MIN, 60), windowSeconds: MINUTE }),
  'auth-sso': (env) => ({ limit: positiveInt(env.AUTH_SSO_RATE_LIMIT_PER_MIN, 60), windowSeconds: MINUTE }),
  'auth-refresh': (env) => ({ limit: positiveInt(env.AUTH_REFRESH_RATE_LIMIT_PER_MIN, 120), windowSeconds: MINUTE }),
};

export function rateLimitSpec(name: RateLimitName, env: NodeJS.ProcessEnv): RateLimitSpec {
  return SPECS[name](env);
}

/** Auth quotas count per client IP (`req.ip`, so TRUST_PROXY must match the proxy chain). */
export function rateLimitKey(name: RateLimitName, ip: string | undefined): string {
  return `${name}:ip:${ip || 'unknown'}`;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number((raw ?? '').trim());
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

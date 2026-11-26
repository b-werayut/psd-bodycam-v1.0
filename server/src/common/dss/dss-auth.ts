import { SignJWT } from 'jose';
import { describeDssFetchFailure, dssEndpointLabel } from './dss-fetch-error';

/** Must match AUDIENCE in psd-bwc-dss-services `app/core/api_token.py`. */
const TOKEN_AUDIENCE = 'psd-bwc-dss-services';
const TOKEN_ISSUER = 'bwc-nest';
/** FastAPI accepts at most 300 s and 30 s of clock skew. */
const TOKEN_LIFETIME_SECONDS = 60;

/**
 * `Authorization` for psd-bwc-dss-services: a new HS256 JWT per request signed with `DSS_API_KEY`
 * (= the middleware's `API_SECRET_KEY`). The key never leaves this process; no login, refresh or cache.
 * A 401 means a wrong key or more than 30 s of clock skew — retrying gives 401 again.
 */
export async function dssAuthorizationHeader(apiKey: string, nowMs: number = Date.now()): Promise<string> {
  const now = Math.floor(nowMs / 1000);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_LIFETIME_SECONDS)
    .sign(new TextEncoder().encode(apiKey));
  return `Bearer ${token}`;
}

/**
 * One HTTP exchange with a single deadline covering the headers **and** the body (a server that sends
 * headers then stalls must not hold a poll cycle for undici's 300 s body timeout). Errors name the
 * endpoint and the network cause.
 */
export async function dssRequest(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (error) {
    if (controller.signal.aborted || (error as Error).name === 'AbortError') {
      throw new Error(`DSS at ${dssEndpointLabel(url)} did not respond within ${timeoutMs} ms`);
    }
    // undici wraps every cause as `TypeError: fetch failed`; the real one is in error.cause
    throw Object.assign(new Error(describeDssFetchFailure(url, error)), { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

import { readBookingInboundConfig } from '../../modules/booking-integration/inbound/booking-inbound.config';
import { resolveTrustProxy } from './trust-proxy';
import {
  REFRESH_TTL_ENV_DEVICE,
  REFRESH_TTL_ENV_WEB,
  resolveRefreshTtl,
} from './refresh-ttl';

export type ReadinessLevel = 'pass' | 'warn' | 'fail';

export type ReadinessCheck = {
  id: string;
  level: ReadinessLevel;
  message: string;
};

const MIN_SECRET_LENGTH = 32;

const has = (value: string | undefined): boolean => (value ?? '').trim().length > 0;

function checkCors(env: NodeJS.ProcessEnv): ReadinessCheck {
  const raw = (env.CORS_ORIGINS ?? '').trim();
  if (!raw) {
    return {
      id: 'CORS_ORIGINS',
      level: 'fail',
      message: 'not set - the system falls back to the dev value (localhost), so the real web app cannot call the API',
    };
  }
  if (raw.split(',').some((o) => o.trim() === '*')) {
    return {
      id: 'CORS_ORIGINS',
      level: 'fail',
      message: '`*` is not allowed - the refresh token is an httpOnly cookie that needs credentials:true, which does not work with a wildcard',
    };
  }
  const insecure = raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.startsWith('http://') && !o.includes('localhost') && !o.includes('127.0.0.1'));
  if (insecure.length > 0) {
    return {
      id: 'CORS_ORIGINS',
      level: 'warn',
      message: `origins still on http: ${insecure.join(', ')} - without HTTPS the browser blocks navigator.geolocation system-wide (check-in has no coordinates)`,
    };
  }
  return { id: 'CORS_ORIGINS', level: 'pass', message: raw };
}

function checkCookieSameSite(env: NodeJS.ProcessEnv): ReadinessCheck {
  const raw = (env.COOKIE_SAMESITE ?? '').trim().toLowerCase();

  if (raw && !['lax', 'none', 'strict'].includes(raw)) {
    return {
      id: 'COOKIE_SAMESITE',
      level: 'fail',
      message: `value '${raw}' is invalid - only lax | none | strict are accepted (the system falls back to lax, which may not be what you want)`,
    };
  }

  if (raw === 'none') {
    return {
      id: 'COOKIE_SAMESITE',
      level: 'warn',
      message:
        "none = the cookie becomes third-party - Safari blocks it by default and Chrome is phasing it out - iPhones are the field crew's main devices; if the web app and the API can move under the same parent domain, use lax instead",
    };
  }

  if (raw === 'strict') {
    return {
      id: 'COOKIE_SAMESITE',
      level: 'warn',
      message: 'strict means the cookie is not sent when the user arrives from an external link (including links in notification emails)',
    };
  }

  return {
    id: 'COOKIE_SAMESITE',
    level: 'pass',
    message: 'lax - works for the same origin and for sibling subdomains under the same parent domain',
  };
}

function checkTrustProxy(env: NodeJS.ProcessEnv): ReadinessCheck {
  const { value, error } = resolveTrustProxy(env);
  if (error) return { id: 'TRUST_PROXY', level: 'fail', message: error };
  if (value === false) {
    return {
      id: 'TRUST_PROXY',
      level: 'warn',
      message:
        'proxy trust is off - correct only when Node receives requests directly from the internet; with nginx in front, req.ip is the proxy IP on every request (AuditLogs.IpAddress is identical everywhere and the per-IP quota becomes shared by everyone)',
    };
  }
  return {
    id: 'TRUST_PROXY',
    level: 'pass',
    message: `${Array.isArray(value) ? value.join(', ') : value} - must match the real number of proxy hops`,
  };
}

const WEB_REFRESH_TTL_WARN_HOURS = 24;

function checkRefreshTtl(env: NodeJS.ProcessEnv): ReadinessCheck[] {
  const { webHours, deviceHours, warnings } = resolveRefreshTtl(env);
  const checks: ReadinessCheck[] = [];

  if (warnings.length) {
    checks.push({ id: REFRESH_TTL_ENV_WEB, level: 'warn', message: warnings.join(' · ') });
  } else if (webHours > WEB_REFRESH_TTL_WARN_HOURS) {
    checks.push({
      id: REFRESH_TTL_ENV_WEB,
      level: 'warn',
      message: `${webHours} h - this controls the "web" session, which has no device registry to revoke per device (the only way is a password reset, which kicks every device of that user) · shared machines stay logged in this long · to keep the mobile app logged in longer, set ${REFRESH_TTL_ENV_DEVICE} instead`,
    });
  } else {
    checks.push({
      id: REFRESH_TTL_ENV_WEB,
      level: 'pass',
      message: `${webHours} h (web - the cookie and the RefreshTokens row use the same value)`,
    });
  }

  checks.push({
    id: REFRESH_TTL_ENV_DEVICE,
    level: 'pass',
    message:
      deviceHours === webHours
        ? `not set - the mobile app uses the same value as the web (${webHours} h) · closing the app overnight requires logging in again`
        : `${deviceHours} h - only for sessions with a registered device (revocable per device on the /users page)`,
  });

  return checks;
}

function checkAzureAd(env: NodeJS.ProcessEnv): ReadinessCheck[] {
  const passwordOn = (env.AUTH_PASSWORD_LOGIN_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
  const tenant = (env.AZURE_AD_TENANT_ID ?? '').trim();
  const client = (env.AZURE_AD_CLIENT_ID ?? '').trim();

  if (!tenant && !client) {
    return [
      {
        id: 'AZURE_AD_*',
        level: passwordOn ? 'warn' : 'fail',
        message: passwordOn
          ? 'not set - the corporate-account sign-in button is hidden, leaving only username + password'
          : 'SSO is not set and password login is disabled too - there is no way to sign in',
      },
    ];
  }
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const bad = [
    !tenant ? 'AZURE_AD_TENANT_ID (not set)' : null,
    !client ? 'AZURE_AD_CLIENT_ID (not set)' : null,
    tenant && !guid.test(tenant) ? 'AZURE_AD_TENANT_ID (not a GUID)' : null,
    client && !guid.test(client) ? 'AZURE_AD_CLIENT_ID (not a GUID)' : null,
  ].filter(Boolean);

  if (bad.length > 0) {
    return [{ id: 'AZURE_AD_*', level: 'fail', message: `invalid configuration: ${bad.join(', ')}` }];
  }
  return [{ id: 'AZURE_AD_*', level: 'pass', message: `tenant ${tenant}` }];
}

function checkDss(env: NodeJS.ProcessEnv): ReadinessCheck[] {
  const driver = (env.DSS_DRIVER ?? '').trim().toLowerCase();
  const checks: ReadinessCheck[] = [
    driver === 'dss'
      ? { id: 'DSS_DRIVER', level: 'pass', message: 'dss' }
      : {
          id: 'DSS_DRIVER',
          level: 'fail',
          message: `'${driver || '(not set = mock)'}' - production must be dss, otherwise the whole system uses simulated cameras`,
        },
  ];
  checks.push(
    has(env.DSS_BASE_URL)
      ? { id: 'DSS_BASE_URL', level: 'pass', message: 'set' }
      : { id: 'DSS_BASE_URL', level: 'fail', message: 'not set - cannot fetch positions / status / the camera list' },
  );
  const key = (env.DSS_API_KEY ?? '').trim();
  if (!key) checks.push({ id: 'DSS_API_KEY', level: 'fail', message: 'not set - psd-bwc-dss-services answers 401 to every request' });
  else if (key.length < MIN_SECRET_LENGTH) {
    checks.push({
      id: 'DSS_API_KEY',
      level: 'warn',
      message: `shorter than ${MIN_SECRET_LENGTH} characters - this key signs the JWT on every request to DSS`,
    });
  } else checks.push({ id: 'DSS_API_KEY', level: 'pass', message: `${key.length} characters` });
  return checks;
}

function checkBookingInbound(env: NodeJS.ProcessEnv): ReadinessCheck {
  let secrets: string[];
  try {
    // Same parsing as the endpoint itself: "," alone leaves zero usable secrets.
    secrets = readBookingInboundConfig(env).secrets;
  } catch (err) {
    return { id: 'BOOKING_INBOUND_SECRETS', level: 'fail', message: (err as Error).message };
  }
  if (secrets.length === 0) {
    return { id: 'BOOKING_INBOUND_SECRETS', level: 'warn', message: 'the work-order inbound endpoint is disabled (answers 401 to every request)' };
  }
  // every secret is accepted by the endpoint (current + the old one kept while rotating), so each must be strong
  const placeholder = secrets.findIndex((s) => s.toUpperCase().includes('CHANGE_ME'));
  if (placeholder >= 0) {
    return {
      id: 'BOOKING_INBOUND_SECRETS',
      level: 'fail',
      message: `BOOKING_INBOUND_SECRETS value #${placeholder + 1} is still a placeholder (CHANGE_ME) - anyone can send fake work orders into the system`,
    };
  }
  const short = secrets.findIndex((s) => s.length < MIN_SECRET_LENGTH);
  if (short >= 0) {
    return {
      id: 'BOOKING_INBOUND_SECRETS',
      level: 'fail',
      message: `BOOKING_INBOUND_SECRETS value #${short + 1} is ${secrets[short]!.length} characters - use at least ${MIN_SECRET_LENGTH} random characters`,
    };
  }
  return { id: 'BOOKING_INBOUND_SECRETS', level: 'pass', message: `set (${secrets.length} values)` };
}

export function checkProdEnv(env: NodeJS.ProcessEnv): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];

  checks.push(
    env.NODE_ENV === 'production'
      ? { id: 'NODE_ENV', level: 'pass', message: 'production' }
      : {
          id: 'NODE_ENV',
          level: 'warn',
          message: `still '${env.NODE_ENV ?? '(not set)'}' - set it to production to turn off verbose logging and make Nest use production mode`,
        },
  );

  checks.push(
    has(env.DATABASE_URL)
      ? { id: 'DATABASE_URL', level: 'pass', message: 'set' }
      : { id: 'DATABASE_URL', level: 'fail', message: 'not set - the process cannot boot' },
  );

  const jwt = (env.JWT_ACCESS_SECRET ?? '').trim();
  if (!jwt) {
    checks.push({ id: 'JWT_ACCESS_SECRET', level: 'fail', message: 'not set' });
  } else if (jwt.length < MIN_SECRET_LENGTH) {
    checks.push({
      id: 'JWT_ACCESS_SECRET',
      level: 'fail',
      message: `${jwt.length} characters - use at least ${MIN_SECRET_LENGTH} random characters`,
    });
  } else {
    checks.push({ id: 'JWT_ACCESS_SECRET', level: 'pass', message: `${jwt.length} characters` });
  }

  checks.push(checkCors(env));

  checks.push(
    env.COOKIE_SECURE === 'true'
      ? { id: 'COOKIE_SECURE', level: 'pass', message: 'true' }
      : {
          id: 'COOKIE_SECURE',
          level: 'fail',
          message: 'must be true on HTTPS - otherwise the refresh cookie can be sent over http',
        },
  );

  checks.push(checkCookieSameSite(env));
  checks.push(checkTrustProxy(env));
  checks.push(...checkRefreshTtl(env));

  checks.push(
    has(env.REDIS_URL)
      ? { id: 'REDIS_URL', level: 'pass', message: 'set' }
      : {
          id: 'REDIS_URL',
          level: 'fail',
          message: 'not set - positions/alerts from the worker are saved to the DB but never pushed to screens, and export jobs stay Queued forever',
        },
  );

  checks.push(...checkAzureAd(env));
  checks.push(...checkDss(env));
  checks.push(checkBookingInbound(env));
  if (has(env.SEED_DEMO_PASSWORD)) {
    checks.push({
      id: 'SEED_DEMO_PASSWORD',
      level: 'fail',
      message: 'must not be set in production - it is the demo account password used only by db:seed (dev)',
    });
  }

  return checks;
}

export function summarizeReadiness(checks: ReadinessCheck[]): {
  ok: boolean;
  fail: number;
  warn: number;
  pass: number;
} {
  const count = (level: ReadinessLevel) => checks.filter((c) => c.level === level).length;
  const fail = count('fail');
  return { ok: fail === 0, fail, warn: count('warn'), pass: count('pass') };
}

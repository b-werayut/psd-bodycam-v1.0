export const REFRESH_TTL_ENV_WEB = 'REFRESH_TOKEN_TTL_HOURS';
export const REFRESH_TTL_ENV_DEVICE = 'REFRESH_TOKEN_TTL_HOURS_DEVICE';

export const DEFAULT_REFRESH_TTL_HOURS = 8;

export interface RefreshTtlPlan {
  webHours: number;
  deviceHours: number;
  warnings: string[];
}

type ParsedHours = number | 'unset' | 'invalid';

function parseHours(raw: string | undefined): ParsedHours {
  const text = (raw ?? '').trim();
  if (!text) return 'unset';
  const hours = Number(text);
  if (!Number.isFinite(hours) || hours <= 0) return 'invalid';
  return hours;
}

export function resolveRefreshTtl(env: NodeJS.ProcessEnv): RefreshTtlPlan {
  const warnings: string[] = [];

  const web = parseHours(env[REFRESH_TTL_ENV_WEB]);
  const webHours = typeof web === 'number' ? web : DEFAULT_REFRESH_TTL_HOURS;
  if (web === 'invalid') {
    warnings.push(
      `${REFRESH_TTL_ENV_WEB}='${env[REFRESH_TTL_ENV_WEB]}' is invalid (must be a number of hours greater than 0) - falling back to ${DEFAULT_REFRESH_TTL_HOURS} hours`,
    );
  }

  const device = parseHours(env[REFRESH_TTL_ENV_DEVICE]);
  const deviceHours = typeof device === 'number' ? device : webHours;
  if (device === 'invalid') {
    warnings.push(
      `${REFRESH_TTL_ENV_DEVICE}='${env[REFRESH_TTL_ENV_DEVICE]}' is invalid (must be a number of hours greater than 0) - falling back to the web value (${webHours} hours)`,
    );
  }

  if (typeof device === 'number' && device < webHours) {
    warnings.push(
      `${REFRESH_TTL_ENV_DEVICE} (${device} h) is shorter than ${REFRESH_TTL_ENV_WEB} (${webHours} h) - it is meant to be longer; check whether the values were swapped`,
    );
  }

  return { webHours, deviceHours, warnings };
}

export function webRefreshTtlHours(env: NodeJS.ProcessEnv): number {
  return resolveRefreshTtl(env).webHours;
}

export function refreshTtlMs(
  env: NodeJS.ProcessEnv,
  registeredDevice: boolean,
): number {
  const plan = resolveRefreshTtl(env);
  return (registeredDevice ? plan.deviceHours : plan.webHours) * 3600 * 1000;
}

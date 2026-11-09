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
      `${REFRESH_TTL_ENV_WEB}='${env[REFRESH_TTL_ENV_WEB]}' ใช้ไม่ได้ (ต้องเป็นจำนวนชั่วโมงมากกว่า 0) — ถอยไป ${DEFAULT_REFRESH_TTL_HOURS} ชั่วโมง`,
    );
  }

  const device = parseHours(env[REFRESH_TTL_ENV_DEVICE]);
  const deviceHours = typeof device === 'number' ? device : webHours;
  if (device === 'invalid') {
    warnings.push(
      `${REFRESH_TTL_ENV_DEVICE}='${env[REFRESH_TTL_ENV_DEVICE]}' ใช้ไม่ได้ (ต้องเป็นจำนวนชั่วโมงมากกว่า 0) — ถอยไปใช้ค่าเดียวกับเว็บ (${webHours} ชั่วโมง)`,
    );
  }

  if (typeof device === 'number' && device < webHours) {
    warnings.push(
      `${REFRESH_TTL_ENV_DEVICE} (${device} ชม.) สั้นกว่า ${REFRESH_TTL_ENV_WEB} (${webHours} ชม.) — ค่านี้มีไว้ให้ยาวกว่า ตรวจว่าสลับค่ากันไว้หรือไม่`,
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

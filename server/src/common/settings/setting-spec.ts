// Settings shipped by data migrations (Part 3 Settings keys). Adding a key = SETTING_DEFAULTS + SETTING_BOUNDS
// + a data migration. A missing row falls back to these defaults.

export const SETTING_VALUE_TYPE = { STRING: 1, INT: 2, BOOL: 3 } as const;

export const SETTING_DEFAULTS = {
  'auth.max-failed-logins': 3,
  'auth.lockout-minutes': 15,
  'gps.poll-interval-seconds': 15,
  'status.unknown-after-seconds': 120,
  'status.display-cache-seconds': 10,
  'depot.fix-max-age-minutes': 30,
  'tracking.stop-min-minutes': 5,
  'tracking.stop-radius-meters': 50,
  'streaming.enabled': true,
  'streaming.max-concurrent-per-user': 16,
  'streaming.url-ttl-seconds': 180,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export type SettingBound = { min: number; max: number };

export const SETTING_BOUNDS: Record<SettingKey, SettingBound> = {
  'auth.max-failed-logins': { min: 3, max: 20 },
  'auth.lockout-minutes': { min: 1, max: 1440 },
  'gps.poll-interval-seconds': { min: 5, max: 300 },
  'status.unknown-after-seconds': { min: 30, max: 3600 },
  'status.display-cache-seconds': { min: 0, max: 60 },
  'depot.fix-max-age-minutes': { min: 5, max: 240 },
  'tracking.stop-min-minutes': { min: 1, max: 120 },
  'tracking.stop-radius-meters': { min: 10, max: 500 },
  'streaming.enabled': { min: 0, max: 1 },
  'streaming.max-concurrent-per-user': { min: 1, max: 50 },
  'streaming.url-ttl-seconds': { min: 30, max: 3600 },
};

/** `atLeast` must be ≥ `factor` × `of` (Part 3 §3.11: unknown-after ≥ 2 × poll). */
export type SettingPairRule = { atLeast: SettingKey; factor: number; of: SettingKey };

export const SETTING_PAIR_RULES: readonly SettingPairRule[] = [
  { atLeast: 'status.unknown-after-seconds', factor: 2, of: 'gps.poll-interval-seconds' },
];

/** Keys whose change must be checked against another setting. */
export function pairedKeysOf(key: string): SettingKey[] {
  return SETTING_PAIR_RULES.flatMap((r) => (r.atLeast === key ? [r.of] : r.of === key ? [r.atLeast] : []));
}

/** Checks every pair rule whose two keys are both in `values`. */
export function checkSettingPairs(
  values: Partial<Record<SettingKey, number>>,
): { ok: true } | { ok: false; message: string } {
  for (const rule of SETTING_PAIR_RULES) {
    const low = values[rule.atLeast];
    const base = values[rule.of];
    if (low === undefined || base === undefined) continue;
    const min = rule.factor * base;
    if (low < min) {
      return {
        ok: false,
        message: `${rule.atLeast} (${low}) ต้องไม่น้อยกว่า ${rule.factor} เท่าของ ${rule.of} (${base}) คือ ${min}`,
      };
    }
  }
  return { ok: true };
}

export function settingBound(key: string): SettingBound | undefined {
  return (SETTING_BOUNDS as Record<string, SettingBound | undefined>)[key];
}

export type SettingCheck = { ok: true; normalized: string } | { ok: false; message: string };

export function checkSettingValue(key: string, valueType: number, raw: string): SettingCheck {
  const trimmed = raw.trim();

  if (valueType === SETTING_VALUE_TYPE.BOOL) {
    if (/^(true|1|yes)$/i.test(trimmed)) return { ok: true, normalized: 'true' };
    if (/^(false|0|no)$/i.test(trimmed)) return { ok: true, normalized: 'false' };
    return { ok: false, message: `ค่าของ ${key} ต้องเป็น true หรือ false` };
  }

  if (valueType === SETTING_VALUE_TYPE.INT) {
    if (!/^-?\d+$/.test(trimmed)) return { ok: false, message: `ค่าของ ${key} ต้องเป็นจำนวนเต็ม` };
    const n = Number(trimmed);
    const bound = settingBound(key);
    if (bound && n < bound.min) return { ok: false, message: `ค่าของ ${key} ต้องไม่น้อยกว่า ${bound.min}` };
    if (bound && n > bound.max) return { ok: false, message: `ค่าของ ${key} ต้องไม่เกิน ${bound.max}` };
    return { ok: true, normalized: String(n) };
  }

  if (!trimmed) return { ok: false, message: `ค่าของ ${key} ต้องไม่เป็นค่าว่าง` };
  return { ok: true, normalized: trimmed };
}

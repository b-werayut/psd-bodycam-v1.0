// Settings shipped by data migrations (Part 3 Settings keys). Adding a key = SETTING_DEFAULTS + SETTING_BOUNDS
// + a data migration. A missing row falls back to these defaults.

export const SETTING_VALUE_TYPE = { STRING: 1, INT: 2, BOOL: 3 } as const;

export const SETTING_DEFAULTS = {
  'auth.max-failed-logins': 3,
  'auth.lockout-minutes': 15,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export type SettingBound = { min: number; max: number };

export const SETTING_BOUNDS: Record<SettingKey, SettingBound> = {
  'auth.max-failed-logins': { min: 3, max: 20 },
  'auth.lockout-minutes': { min: 1, max: 1440 },
};

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

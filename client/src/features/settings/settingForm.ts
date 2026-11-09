import type { TranslationKey } from '@/i18n/locales/th';
import { VALUE_TYPE, type SettingItem } from './settings.api';

/** Unknown categories render their raw code; later phases add session, matching, workorder, booking. */
export const CATEGORY_LABEL_KEY: Record<string, TranslationKey> = {
  auth: 'settings.category.auth',
};

/** Client-side check only — the server stays the authority (SETTING_OUT_OF_RANGE). */
export function validateSettingInput(item: SettingItem, raw: string): TranslationKey | null {
  const value = raw.trim();

  if (item.valueType === VALUE_TYPE.BOOL) return null;

  if (item.valueType === VALUE_TYPE.INT) {
    if (!/^-?\d+$/.test(value)) return 'settings.error.int';
    const n = Number(value);
    if (item.min != null && n < item.min) return 'settings.error.min';
    if (item.max != null && n > item.max) return 'settings.error.max';
    return null;
  }

  return value ? null : 'settings.error.required';
}

export function boundHint(item: SettingItem): TranslationKey | null {
  if (item.valueType !== VALUE_TYPE.INT) return null;
  if (item.min != null && item.max != null) return 'settings.hint.range';
  if (item.min != null) return 'settings.hint.min';
  if (item.max != null) return 'settings.hint.max';
  return null;
}

export const isTruthySetting = (value: string): boolean => /^(true|1|yes)$/i.test(value.trim());

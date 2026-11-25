import type { Language } from '@/i18n/types';
import { LOCALE_TAG } from './time';

/** `850 ม.` under 1 km, else `2.4 กม.` (at most one decimal) — `850 m` / `2.4 km` in English. */
export function formatDistance(meters: number, locale: Language): string {
  const rounded = Math.round(meters);
  const [value, unit] = rounded < 1000 ? [rounded, 'meter'] : [rounded / 1000, 'kilometer'];
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: unit === 'meter' ? 0 : 1,
  }).format(value);
}

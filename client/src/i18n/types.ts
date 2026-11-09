export const SUPPORTED_LANGUAGES = ['th', 'en'] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export type TranslationParams = Record<string, string | number>;

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value as Language);
}

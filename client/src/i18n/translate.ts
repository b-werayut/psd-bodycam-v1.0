import { en } from './locales/en';
import { th, type TranslationKey } from './locales/th';
import type { Language, TranslationParams } from './types';

const dictionaries = { th, en } satisfies Record<
  Language,
  Record<TranslationKey, string>
>;

export function translate(
  language: Language,
  key: TranslationKey,
  params?: TranslationParams,
) {
  const message = dictionaries[language][key] ?? key;
  if (!params) return message;

  return message.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

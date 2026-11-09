import { describe, expect, it } from 'vitest';

import { th } from './locales/th';
import { translate } from './translate';
import type { TranslationKey } from './locales/th';

describe('translate', () => {
  it('returns the Thai string', () => {
    expect(translate('th', 'common.loading')).toBe(th['common.loading']);
  });

  it('interpolates params', () => {
    const text = translate('en', 'common.pagination.pageOf', { page: 2, total: 5 });
    expect(text).toContain('2');
    expect(text).toContain('5');
  });

  it('falls back to the key for unknown keys', () => {
    expect(translate('th', 'no.such.key' as TranslationKey)).toBe('no.such.key');
  });
});

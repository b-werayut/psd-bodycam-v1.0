import { describe, expect, it } from 'vitest';

import { en } from './en';
import { th } from './th';

describe('locale parity', () => {
  it('has identical keys in th and en', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(th).sort());
  });

  it('has no empty values', () => {
    for (const dict of [th, en]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), key).not.toBe('');
      }
    }
  });

  it('only uses P0 key prefixes and no company keys', () => {
    const prefixes = /^(app|navigation|breadcrumb|header|language|theme|auth|permission|common|users|departments|employees|settings|audit)\./;
    for (const key of Object.keys(th)) {
      expect(key).toMatch(prefixes);
      expect(key.toLowerCase()).not.toContain('compan');
    }
  });
});

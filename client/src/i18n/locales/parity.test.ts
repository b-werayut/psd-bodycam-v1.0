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

  it('only uses known feature prefixes and no company or department keys', () => {
    const prefixes = /^(app|navigation|breadcrumb|header|language|theme|auth|permission|common|users|employees|settings|audit|tracking|map|liveWall|streaming)\./;
    for (const key of Object.keys(th)) {
      expect(key).toMatch(prefixes);
      expect(key.toLowerCase()).not.toContain('compan');
      // single-department system: no department keys at all
      expect(key.toLowerCase()).not.toContain('department');
    }
  });
});

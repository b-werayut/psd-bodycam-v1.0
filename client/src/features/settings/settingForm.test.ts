import { describe, expect, it } from 'vitest';

import { CATEGORY_LABEL_KEY, validateSettingInput } from './settingForm';
import type { SettingItem } from './settings.api';

const maxFailed: SettingItem = {
  key: 'auth.max-failed-logins',
  value: '5',
  valueType: 2,
  description: 'x',
  min: 3,
  max: 20,
};

describe('validateSettingInput', () => {
  it('accepts an int within range, including the bounds', () => {
    expect(validateSettingInput(maxFailed, '5')).toBeNull();
    expect(validateSettingInput(maxFailed, '3')).toBeNull();
    expect(validateSettingInput(maxFailed, ' 20 ')).toBeNull();
  });

  it('rejects out-of-range and non-integer ints', () => {
    expect(validateSettingInput(maxFailed, '2')).toBe('settings.error.min');
    expect(validateSettingInput(maxFailed, '21')).toBe('settings.error.max');
    expect(validateSettingInput(maxFailed, '4.5')).toBe('settings.error.int');
    expect(validateSettingInput(maxFailed, 'abc')).toBe('settings.error.int');
    expect(validateSettingInput(maxFailed, '')).toBe('settings.error.int');
  });

  it('requires a non-empty string and accepts any bool', () => {
    const str: SettingItem = { key: 'k', value: 'a', valueType: 1, description: '' };
    const bool: SettingItem = { key: 'b', value: 'true', valueType: 3, description: '' };
    expect(validateSettingInput(str, '  ')).toBe('settings.error.required');
    expect(validateSettingInput(str, 'ok')).toBeNull();
    expect(validateSettingInput(bool, 'false')).toBeNull();
  });
});

describe('CATEGORY_LABEL_KEY', () => {
  it('labels auth', () => {
    expect(CATEGORY_LABEL_KEY.auth).toBe('settings.category.auth');
  });
});

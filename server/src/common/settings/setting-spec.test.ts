import { describe, expect, it } from 'vitest';
import { SETTING_BOUNDS, SETTING_DEFAULTS, SETTING_VALUE_TYPE, checkSettingValue } from './setting-spec';

const INT = SETTING_VALUE_TYPE.INT;

describe('setting spec', () => {
  it('lockout defaults: 3 wrong passwords, 15 minutes', () => {
    expect(SETTING_DEFAULTS['auth.max-failed-logins']).toBe(3);
    expect(SETTING_DEFAULTS['auth.lockout-minutes']).toBe(15);
  });

  it('every default has bounds that contain it', () => {
    for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
      const bound = SETTING_BOUNDS[key as keyof typeof SETTING_BOUNDS];
      expect(bound, key).toBeDefined();
      expect(value).toBeGreaterThanOrEqual(bound.min);
      expect(value).toBeLessThanOrEqual(bound.max);
    }
  });

  it('accepts an int inside the bounds and normalizes it', () => {
    expect(checkSettingValue('auth.max-failed-logins', INT, ' 07 ')).toEqual({ ok: true, normalized: '7' });
    expect(checkSettingValue('auth.lockout-minutes', INT, '1440')).toEqual({ ok: true, normalized: '1440' });
  });

  it('rejects values outside the bounds with a Thai message', () => {
    const tooLow = checkSettingValue('auth.max-failed-logins', INT, '0');
    expect(tooLow).toMatchObject({ ok: false });
    expect(tooLow.ok ? '' : tooLow.message).toContain('ไม่น้อยกว่า 3');
    expect(checkSettingValue('auth.max-failed-logins', INT, '21')).toMatchObject({ ok: false });
    expect(checkSettingValue('auth.lockout-minutes', INT, '0')).toMatchObject({ ok: false });
  });

  it('rejects non-integers for an int setting', () => {
    for (const raw of ['abc', '3.5', '', '1e2']) {
      expect(checkSettingValue('auth.lockout-minutes', INT, raw)).toMatchObject({ ok: false });
    }
  });

  it('bool and string settings', () => {
    expect(checkSettingValue('x.flag', SETTING_VALUE_TYPE.BOOL, 'YES')).toEqual({ ok: true, normalized: 'true' });
    expect(checkSettingValue('x.flag', SETTING_VALUE_TYPE.BOOL, 'maybe')).toMatchObject({ ok: false });
    expect(checkSettingValue('x.name', SETTING_VALUE_TYPE.STRING, '  a ')).toEqual({ ok: true, normalized: 'a' });
    expect(checkSettingValue('x.name', SETTING_VALUE_TYPE.STRING, '  ')).toMatchObject({ ok: false });
  });
});

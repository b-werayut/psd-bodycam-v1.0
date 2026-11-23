import { describe, expect, it } from 'vitest';
import {
  SETTING_BOUNDS,
  SETTING_DEFAULTS,
  SETTING_VALUE_TYPE,
  checkSettingPairs,
  checkSettingValue,
} from './setting-spec';

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

  it('P1 tracking settings: defaults and bounds (Part 3 §3.11)', () => {
    expect(SETTING_DEFAULTS).toMatchObject({
      'gps.poll-interval-seconds': 15,
      'status.unknown-after-seconds': 120,
      'status.display-cache-seconds': 10,
      'depot.fix-max-age-minutes': 30,
      'tracking.stop-min-minutes': 5,
      'tracking.stop-radius-meters': 50,
    });
    expect(SETTING_BOUNDS).toMatchObject({
      'gps.poll-interval-seconds': { min: 5, max: 300 },
      'status.unknown-after-seconds': { min: 30, max: 3600 },
      'status.display-cache-seconds': { min: 0, max: 60 },
      'depot.fix-max-age-minutes': { min: 5, max: 240 },
      'tracking.stop-min-minutes': { min: 1, max: 120 },
      'tracking.stop-radius-meters': { min: 10, max: 500 },
    });
    expect(checkSettingValue('status.display-cache-seconds', INT, '0')).toEqual({ ok: true, normalized: '0' });
  });

  it('pair rule: status.unknown-after-seconds must be at least 2 × gps.poll-interval-seconds', () => {
    expect(checkSettingPairs({ 'gps.poll-interval-seconds': 15, 'status.unknown-after-seconds': 30 })).toEqual({
      ok: true,
    });
    const bad = checkSettingPairs({ 'gps.poll-interval-seconds': 61, 'status.unknown-after-seconds': 120 });
    expect(bad).toMatchObject({ ok: false });
    expect(bad.ok ? '' : bad.message).toContain('status.unknown-after-seconds');
    expect(bad.ok ? '' : bad.message).toContain('122');
    // a rule with a missing side is not checked
    expect(checkSettingPairs({ 'gps.poll-interval-seconds': 300 })).toEqual({ ok: true });
  });
});

import { describe, expect, it } from 'vitest';
import { ParseBigIntPipe } from './parse-bigint.pipe';

describe('ParseBigIntPipe', () => {
  const pipe = new ParseBigIntPipe();

  it('turns a decimal id into a bigint', () => {
    expect(pipe.transform('42')).toBe(42n);
    expect(pipe.transform('9223372036854775807')).toBe(9223372036854775807n);
  });

  it('rejects anything else with 400', () => {
    for (const raw of ['', 'abc', '-1', '1.5', '12345678901234567890', ' 1']) {
      expect(() => pipe.transform(raw)).toThrow();
      try {
        pipe.transform(raw);
      } catch (error) {
        expect((error as { getStatus(): number }).getStatus()).toBe(400);
      }
    }
  });
});

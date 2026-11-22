import { describe, expect, it } from 'vitest';
import { normalizeUsername } from './username';

describe('normalizeUsername', () => {
  it('trims and lowercases', () => {
    expect(normalizeUsername('  Admin ')).toBe('admin');
    expect(normalizeUsername('Operator1')).toBe('operator1');
  });

  it('leaves an already normal username unchanged', () => {
    expect(normalizeUsername('viewer1')).toBe('viewer1');
  });
});

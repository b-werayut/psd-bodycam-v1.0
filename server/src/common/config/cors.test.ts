import { afterEach, describe, expect, it } from 'vitest';
import { corsOrigins } from './cors';

const original = process.env.CORS_ORIGINS;
afterEach(() => {
  if (original === undefined) delete process.env.CORS_ORIGINS;
  else process.env.CORS_ORIGINS = original;
});

describe('corsOrigins', () => {
  it('falls back to dev origins when unset', () => {
    delete process.env.CORS_ORIGINS;
    expect(corsOrigins()).toContain('http://localhost:5173');
  });

  it('returns true for wildcard', () => {
    process.env.CORS_ORIGINS = '*';
    expect(corsOrigins()).toBe(true);
  });

  it('splits and trims a comma list', () => {
    process.env.CORS_ORIGINS = ' https://a.example , https://b.example,, ';
    expect(corsOrigins()).toEqual(['https://a.example', 'https://b.example']);
  });
});

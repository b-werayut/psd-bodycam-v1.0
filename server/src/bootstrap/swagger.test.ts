import { describe, expect, it } from 'vitest';
import { isSwaggerEnabled } from './swagger';

describe('isSwaggerEnabled', () => {
  it('on outside production', () => {
    expect(isSwaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(isSwaggerEnabled({ NODE_ENV: 'test' })).toBe(true);
    expect(isSwaggerEnabled({})).toBe(true);
  });

  it('off in production unless SWAGGER_ENABLED=true', () => {
    expect(isSwaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' })).toBe(true);
  });

  it('SWAGGER_ENABLED=false turns it off anywhere', () => {
    expect(isSwaggerEnabled({ NODE_ENV: 'development', SWAGGER_ENABLED: 'false' })).toBe(false);
  });
});

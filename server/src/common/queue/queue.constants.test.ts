import { describe, expect, it } from 'vitest';
import { queuePrefix } from './queue.constants';

describe('queue constants', () => {
  it('queuePrefix uses the database name', () => {
    expect(queuePrefix({ DATABASE_URL: 'postgres://u:p@h:5432/bwc_test' })).toBe('bq-bwc_test');
  });
  it('queuePrefix falls back to default', () => {
    expect(queuePrefix({})).toBe('bq-default');
    expect(queuePrefix({ DATABASE_URL: 'not a url' })).toBe('bq-default');
  });
});

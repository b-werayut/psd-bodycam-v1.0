import { describe, expect, it } from 'vitest';
import { parseWorkerRoles } from './worker-roles';

describe('parseWorkerRoles', () => {
  it('defaults to all roles when unset or empty', () => {
    expect(parseWorkerRoles(undefined)).toEqual(['tracking', 'integration', 'media']);
    expect(parseWorkerRoles('')).toEqual(['tracking', 'integration', 'media']);
    expect(parseWorkerRoles('  ')).toEqual(['tracking', 'integration', 'media']);
  });

  it('trims, dedupes and returns canonical order', () => {
    expect(parseWorkerRoles(' media, tracking ')).toEqual(['tracking', 'media']);
    expect(parseWorkerRoles('media,media')).toEqual(['media']);
  });

  it('rejects unknown roles naming them', () => {
    expect(() => parseWorkerRoles('tracking,video')).toThrow(/video/);
  });
});

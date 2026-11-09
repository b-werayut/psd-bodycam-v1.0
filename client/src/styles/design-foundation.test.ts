import { describe, expect, it } from 'vitest';

const componentSources = import.meta.glob('../**/*.tsx', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

describe('design foundation policy', () => {
  it('keeps product typography on the shared semantic scale', () => {
    const unsupportedTypeClasses = /text-\[(?:10|11|13|15|17|19)px\]/g;
    const violations = Object.entries(componentSources).flatMap(([path, source]) => {
      if (path.includes('.test.') || path.includes('.stories.')) return [];

      return source.split(/\r?\n/).flatMap((line, index) => {
        const matches = line.match(unsupportedTypeClasses);
        return matches?.map((className) => `${path}:${index + 1} ${className}`) ?? [];
      });
    });

    expect(violations).toEqual([]);
  });
});

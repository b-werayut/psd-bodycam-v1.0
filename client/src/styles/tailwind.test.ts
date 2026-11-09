import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

import stylesheet from './tailwind.css?raw';

describe('global motion accessibility', () => {
  it('stops shared loading rotation when the user requests reduced motion', () => {
    const root = postcss.parse(stylesheet);
    const reducedMotionAnimations: string[] = [];

    root.walkAtRules('media', (media) => {
      if (!media.params.includes('prefers-reduced-motion: reduce')) return;

      media.walkRules('.animate-spin', (rule) => {
        rule.walkDecls('animation', (declaration) => {
          reducedMotionAnimations.push(declaration.value);
        });
      });
    });

    expect(reducedMotionAnimations).toContain('none');
  });
});

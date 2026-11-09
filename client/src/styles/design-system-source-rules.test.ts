import { describe, expect, it } from 'vitest';
import buttonSource from '../components/ui/button.tsx?raw';
import fieldSource from '../components/ui/field.tsx?raw';
import inputSource from '../components/ui/input.tsx?raw';
import searchSelectSource from '../components/ui/search-select.tsx?raw';
import selectSource from '../components/ui/select.tsx?raw';
import skeletonSource from '../components/ui/skeleton.tsx?raw';
import textareaSource from '../components/ui/textarea.tsx?raw';

describe('design system source rules', () => {
  it('locks the shared Premium Operational primitive vocabulary', () => {
    expect(inputSource).toContain('text-control');
    expect(selectSource).toContain('text-control');
    expect(textareaSource).toContain('text-control');
    expect(fieldSource).toContain("vertical: 'flex-col'");
    expect(searchSelectSource).toContain('overflow-y-auto');
    expect(skeletonSource).toContain('motion-reduce:animate-none');
    expect(buttonSource).toContain('destructive:');
  });
});

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from './skeleton';

describe('Skeleton', () => {
  it('uses a sweeping shimmer instead of a pulsing loading animation', () => {
    const { container } = render(<Skeleton />);
    const skeleton = container.firstElementChild;

    expect(skeleton).toHaveClass('nwl-skeleton-shimmer');
    expect(skeleton).toHaveClass('motion-reduce:animate-none');
    expect(skeleton).not.toHaveClass('animate-pulse');
  });
});

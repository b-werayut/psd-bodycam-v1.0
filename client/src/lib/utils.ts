import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const mergeDesignTokens = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        'text-caption',
        'text-control',
        'text-body',
        'text-field',
        'text-subheading',
        'text-heading',
        'text-display',
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return mergeDesignTokens(clsx(inputs));
}

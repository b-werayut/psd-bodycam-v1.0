import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'destructive';

interface StatusBadgeProps {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}

const TONE = {
  neutral: {
    label: 'text-muted-foreground',
    dot: 'bg-unknown',
  },
  info: {
    label: 'text-info',
    dot: 'bg-info',
  },
  success: {
    label: 'text-success',
    dot: 'bg-success',
  },
  warning: {
    label: 'text-warning-foreground',
    dot: 'bg-warning-foreground',
  },
  destructive: {
    label: 'text-destructive',
    dot: 'bg-destructive',
  },
} as const;

export function StatusBadge({ tone, children, className }: StatusBadgeProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium',
        TONE[tone].label,
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', TONE[tone].dot)} />
      {children}
    </span>
  );
}

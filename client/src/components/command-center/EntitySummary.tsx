import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface EntitySummaryProps {
  label: string;
  title: ReactNode;
  identifier?: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  className?: string;
}

export function EntitySummary({
  label,
  title,
  identifier,
  meta,
  leading,
  className,
}: EntitySummaryProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex min-w-0 items-center gap-3', className)}
    >
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="truncate text-sm font-semibold text-foreground">{title}</span>
          {identifier ? (
            <span className="font-mono text-xs text-muted-foreground">{identifier}</span>
          ) : null}
        </div>
        {meta ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</div>
        ) : null}
      </div>
    </div>
  );
}

import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  eyebrow?: ReactNode;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  eyebrow,
  description,
  meta,
  actions,
  className,
}: PageHeaderProps) {
  const titleId = useId();

  return (
    <header
      aria-labelledby={titleId}
      className={cn(
        'mb-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-1 text-caption font-medium text-muted-foreground">
            {eyebrow}
          </div>
        ) : null}
        <h1
          id={titleId}
          className="text-balance text-display font-bold tracking-[-0.025em] text-foreground"
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-[70ch] text-pretty text-body text-muted-foreground">
            {description}
          </p>
        ) : null}
        {meta ? (
          <div className="mt-3 text-xs font-medium text-muted-foreground">{meta}</div>
        ) : null}
      </div>

      {actions ? (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 [&>*]:min-w-0 [&>*]:flex-1 sm:w-auto sm:[&>*]:flex-none">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

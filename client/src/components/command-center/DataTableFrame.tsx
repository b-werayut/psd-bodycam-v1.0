import type { ReactNode } from 'react';

import { HorizontalScrollRegion } from '@/components/ui/horizontal-scroll-region';
import { cn } from '@/lib/utils';

interface DataTableFrameProps {
  label: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function DataTableFrame({
  label,
  footer,
  children,
  className,
}: DataTableFrameProps) {
  return (
    <section
      role="region"
      aria-label={label}
      className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}
    >
      <HorizontalScrollRegion label={label} viewportClassName="[&>div]:overflow-visible">
        {children}
      </HorizontalScrollRegion>
      {footer ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

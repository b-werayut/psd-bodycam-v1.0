import { useId, type ReactNode, type Ref } from 'react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface DataPanelProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  titleRef?: Ref<HTMLHeadingElement>;
}

export function DataPanel({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  titleRef,
}: DataPanelProps) {
  const titleId = useId();

  return (
    <Card
      role="region"
      aria-labelledby={titleId}
      className={cn('overflow-hidden rounded-lg border border-border', className)}
    >
      <CardHeader className="min-h-11 flex-row items-center justify-between gap-4 border-b border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <CardTitle
            ref={titleRef}
            id={titleId}
            tabIndex={titleRef ? -1 : undefined}
            className={titleRef ? 'scroll-mt-24' : undefined}
          >
            {title}
          </CardTitle>
          {description ? (
            <CardDescription className="mt-1 leading-5">{description}</CardDescription>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className={cn('p-4', contentClassName)}>{children}</CardContent>
    </Card>
  );
}

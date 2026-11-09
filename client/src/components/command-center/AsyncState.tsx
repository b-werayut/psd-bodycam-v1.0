import { AlertCircle, Inbox, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { cn } from '@/lib/utils';
import { LoadingSkeleton } from './LoadingSkeleton';

interface AsyncStateProps {
  state: 'loading' | 'empty' | 'filtered-empty' | 'error';
  loadingLabel: string;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  filteredEmptyTitle: string;
  filteredEmptyDescription?: string;
  filteredEmptyAction?: ReactNode;
  errorTitle: string;
  errorDescription?: string;
  retryLabel: string;
  onRetry?: () => void;
  className?: string;
}

export function AsyncState({
  state,
  loadingLabel,
  emptyTitle,
  emptyDescription,
  emptyAction,
  filteredEmptyTitle,
  filteredEmptyDescription,
  filteredEmptyAction,
  errorTitle,
  errorDescription,
  retryLabel,
  onRetry,
  className,
}: AsyncStateProps) {
  if (state === 'loading') {
    return <LoadingSkeleton loadingLabel={loadingLabel} className={className} />;
  }

  if (state === 'error') {
    return (
      <Alert
        variant="destructive"
        feedbackScope="page"
        className={cn('border-destructive/40 bg-destructive/5', className)}
      >
        <AlertCircle aria-hidden="true" />
        <div>
          <AlertTitle>{errorTitle}</AlertTitle>
          {errorDescription ? (
            <AlertDescription>{errorDescription}</AlertDescription>
          ) : null}
          {onRetry ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 min-h-11"
              onClick={onRetry}
            >
              {retryLabel}
            </Button>
          ) : null}
        </div>
      </Alert>
    );
  }

  const isFiltered = state === 'filtered-empty';
  const title = isFiltered ? filteredEmptyTitle : emptyTitle;
  const description = isFiltered ? filteredEmptyDescription : emptyDescription;
  const action = isFiltered ? filteredEmptyAction : emptyAction;
  const Icon = isFiltered ? SearchX : Inbox;

  return (
    <Empty
      role="status"
      aria-label={title}
      className={cn('min-h-56 border border-border', className)}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

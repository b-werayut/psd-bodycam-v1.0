import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface LoadingSkeletonProps {
  loadingLabel: string;
  className?: string;
}

export function LoadingSkeleton({ loadingLabel, className }: LoadingSkeletonProps) {
  return (
    <div
      role="status"
      aria-label={loadingLabel}
      className={cn('grid gap-3 p-5', className)}
    >
      <span className="sr-only">{loadingLabel}</span>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-4/5" />
    </div>
  );
}

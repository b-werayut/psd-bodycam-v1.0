import { CircleCheck, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';

const TONE = {
  success: {
    icon: CircleCheck,
    iconClassName: 'bg-success/10 text-success',
    accentClassName: 'bg-success',
    titleClassName: 'text-success',
    duration: 4000,
  },
  error: {
    icon: TriangleAlert,
    iconClassName: 'bg-destructive/10 text-destructive',
    accentClassName: 'bg-destructive',
    titleClassName: 'text-destructive',
    duration: 8000,
  },
} as const;

export type ActionToastTone = keyof typeof TONE;

function ActionToastCard({
  tone,
  title,
  description,
}: {
  tone: ActionToastTone;
  title: string;
  description?: string;
}) {
  const meta = TONE[tone];
  const Icon = meta.icon;

  return (
    <div className="pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-xl bg-surface p-4 text-foreground shadow-lg ring-1 ring-border/80">
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', meta.accentClassName)} />
      <div
        className={cn(
          'ml-1 flex size-10 shrink-0 items-center justify-center rounded-lg',
          meta.iconClassName,
        )}
      >
        <Icon aria-hidden="true" className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-semibold', meta.titleClassName)}>{title}</p>
        {description ? (
          <p className="mt-0.5 line-clamp-3 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );
}

function show(tone: ActionToastTone, title: string, description?: string) {
  return toast.custom(
    () => <ActionToastCard tone={tone} title={title} description={description} />,
    { duration: TONE[tone].duration },
  );
}

export const actionToast = {
  success: (title: string, description?: string) => show('success', title, description),
  error: (title: string, description?: string) => show('error', title, description),
};

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface MetricSummaryProps {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'stat' | 'info' | 'success' | 'warning' | 'destructive';
  className?: string;
}

const toneClasses = {
  neutral: 'bg-muted text-chart-1',
  stat: 'bg-chart-1/[0.06] text-chart-1 dark:bg-chart-1/[0.14]',
  info: 'bg-info/[0.06] text-info dark:bg-info/[0.14]',
  success: 'bg-success/[0.06] text-success dark:bg-success/[0.14]',
  warning: 'bg-warning/[0.06] text-warning dark:bg-warning/[0.14]',
  destructive:
    'bg-destructive/[0.06] text-destructive dark:bg-destructive/[0.14]',
} as const;

export function MetricSummary({
  label,
  value,
  detail,
  icon,
  tone = 'neutral',
  className,
}: MetricSummaryProps) {
  return (
    <div
      role="group"
      aria-label={label}
      data-tone={tone}
      className={cn(
        'flex min-w-0 items-center gap-4 rounded-lg border border-border bg-card p-4',
        className,
      )}
    >
      {icon ? (
        <div
          data-slot="metric-icon"
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-md [&_svg]:size-5',
            toneClasses[tone],
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="min-w-0">
        <p className="text-caption font-medium leading-4 tracking-[0.03em] text-muted-foreground">
          {label}
        </p>
        <div className="mt-0.5 text-heading font-semibold tabular-nums tracking-[-0.02em] text-foreground">
          {value}
        </div>
        {detail ? (
          <div className="mt-0.5 text-caption leading-4 text-muted-foreground">{detail}</div>
        ) : null}
      </div>
    </div>
  );
}

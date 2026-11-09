import type { ReactNode } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Info,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

type StatusTone = 'info' | 'success' | 'warning' | 'destructive';

interface StatusStripProps {
  tone: StatusTone;
  title?: string;
  children: ReactNode;
  className?: string;
}

const toneClasses: Record<StatusTone, string> = {
  info: 'border-primary/25 bg-primary/5 [&>svg]:text-primary',
  success: 'border-success/30 bg-success/5 [&>svg]:text-success',
  warning: 'border-warning/35 bg-warning/10 [&>svg]:text-warning',
  destructive:
    'border-destructive/40 bg-destructive/5 text-foreground [&>svg]:text-destructive',
};

const toneIcons: Record<StatusTone, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  destructive: CircleAlert,
};

export function StatusStrip({
  tone,
  title,
  children,
  className,
}: StatusStripProps) {
  const Icon = toneIcons[tone];

  return (
    <Alert
      data-tone={tone}
      feedbackScope="operational"
      className={cn('rounded-lg shadow-none', toneClasses[tone], className)}
    >
      <Icon aria-hidden="true" />
      <div>
        {title ? <AlertTitle>{title}</AlertTitle> : null}
        <AlertDescription>{children}</AlertDescription>
      </div>
    </Alert>
  );
}

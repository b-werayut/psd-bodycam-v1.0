import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface DataToolbarProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function DataToolbar({ label, children, className }: DataToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={cn(
        'flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center [@media(pointer:fine)]:[&_button]:h-9 [@media(pointer:fine)]:[&_button]:min-h-9 [@media(pointer:fine)]:[&_input]:h-9 [@media(pointer:fine)]:[&_input]:min-h-9 [@media(pointer:fine)]:[&_label]:min-h-9 [@media(pointer:fine)]:[&_select]:h-9 [@media(pointer:fine)]:[&_select]:min-h-9',
        className,
      )}
    >
      {children}
    </div>
  );
}

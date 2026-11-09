import * as React from 'react';

import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const TOOL_TONE = {
  neutral: 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
  view: 'text-info hover:bg-info/15 hover:text-info',
  link: 'text-success hover:bg-success/15 hover:text-success',
  edit: 'text-warning hover:bg-warning/15 hover:text-warning',
  danger: 'text-destructive hover:bg-destructive/10 hover:text-destructive',
} as const;

export type ToolTone = keyof typeof TOOL_TONE;

export interface ToolButtonProps extends Omit<ButtonProps, 'variant' | 'size'> {
  tone?: ToolTone;
}

const ToolButton = React.forwardRef<HTMLButtonElement, ToolButtonProps>(
  ({ tone = 'neutral', className, ...props }, ref) => (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      className={cn(
        'size-11 rounded-full bg-muted p-0 [&_svg]:size-4',
        TOOL_TONE[tone],
        className,
      )}
      {...props}
    />
  ),
);
ToolButton.displayName = 'ToolButton';

export { ToolButton };

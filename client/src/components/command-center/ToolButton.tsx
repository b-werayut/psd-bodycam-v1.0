import * as React from 'react';

import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const TOOL_TONE = {
  neutral: 'text-muted-foreground hover:bg-primary/10 hover:text-primary',
  view: 'text-link hover:bg-accent hover:text-link',
  link: 'text-link hover:bg-accent hover:text-link',
  edit: 'text-link hover:bg-accent hover:text-link',
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
        'size-11 rounded-lg bg-transparent p-0 [@media(pointer:fine)]:size-9 [&_svg]:size-4',
        TOOL_TONE[tone],
        className,
      )}
      {...props}
    />
  ),
);
ToolButton.displayName = 'ToolButton';

export { ToolButton };

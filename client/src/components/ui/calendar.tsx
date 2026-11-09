import * as React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { DayButton, DayPicker, getDefaultClassNames } from 'react-day-picker';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>['variant'];
};

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  buttonVariant = 'ghost',
  components,
  ...props
}: CalendarProps) {
  const defaults = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('group/calendar bg-background p-3 [--cell-size:2.5rem]', className)}
      classNames={{
        root: cn('w-fit', defaults.root),
        months: cn('relative flex flex-col gap-4', defaults.months),
        month: cn('flex w-full flex-col gap-4', defaults.month),
        nav: cn('absolute inset-x-0 top-0 flex items-center justify-between', defaults.nav),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          'size-[--cell-size] select-none p-0 aria-disabled:opacity-50',
          defaults.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          'size-[--cell-size] select-none p-0 aria-disabled:opacity-50',
          defaults.button_next,
        ),
        month_caption: cn(
          'flex h-[--cell-size] items-center justify-center px-[--cell-size]',
          defaults.month_caption,
        ),
        caption_label: cn('select-none text-sm font-semibold', defaults.caption_label),
        month_grid: cn('w-full border-collapse', defaults.month_grid),
        weekdays: cn('flex', defaults.weekdays),
        weekday: cn(
          'flex-1 select-none text-center text-xs font-normal text-muted-foreground',
          defaults.weekday,
        ),
        week: cn('mt-1 flex w-full', defaults.week),
        day: cn('group/day relative size-[--cell-size] p-0 text-center', defaults.day),
        range_start: cn('rounded-l-full bg-primary/15', defaults.range_start),
        range_middle: cn('rounded-none bg-primary/15', defaults.range_middle),
        range_end: cn('rounded-r-full bg-primary/15', defaults.range_end),
        today: cn(
          'rounded-full bg-accent text-accent-foreground data-[selected=true]:rounded-none',
          defaults.today,
        ),
        outside: cn('text-muted-foreground opacity-55', defaults.outside),
        disabled: cn('text-muted-foreground opacity-40', defaults.disabled),
        hidden: cn('invisible', defaults.hidden),
        ...classNames,
      }}
      components={{
        Chevron: ({ className: iconClassName, orientation, ...iconProps }) => {
          if (orientation === 'left') {
            return <ChevronLeft className={cn('size-4', iconClassName)} {...iconProps} />;
          }
          if (orientation === 'right') {
            return <ChevronRight className={cn('size-4', iconClassName)} {...iconProps} />;
          }
          return <ChevronDown className={cn('size-4', iconClassName)} {...iconProps} />;
        },
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaults = getDefaultClassNames();

  return (
    <Button
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        'size-[--cell-size] rounded-full p-0 font-normal',
        'data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground',
        'data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground',
        'data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-primary/15 data-[range-middle=true]:text-foreground',
        'group-data-[focused=true]/day:ring-2 group-data-[focused=true]/day:ring-ring group-data-[focused=true]/day:ring-offset-2',
        defaults.day,
        className,
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton, type CalendarProps };

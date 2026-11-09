import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { CalendarDays, X } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { enUS, th } from 'react-day-picker/locale';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type DateRangeStrings = {
  dateFrom: string;
  dateTo: string;
};

export function dateRangeFromStrings(dateFrom: string, dateTo: string): DateRange | undefined {
  if (!dateFrom && !dateTo) return undefined;
  return {
    from: dateFrom ? parseISO(dateFrom) : undefined,
    to: dateTo ? parseISO(dateTo) : undefined,
  };
}

export function dateRangeToStrings(range: DateRange | undefined): DateRangeStrings {
  return {
    dateFrom: range?.from ? format(range.from, 'yyyy-MM-dd') : '',
    dateTo: range?.to ? format(range.to, 'yyyy-MM-dd') : '',
  };
}

type DateRangePickerProps = {
  value?: DateRange;
  onChange: (range: DateRange | undefined) => void;
  language: 'th' | 'en';
  ariaLabel: string;
  placeholder: string;
  selectEndLabel: string;
  clearLabel: string;
  className?: string;
};

export function DateRangePicker({
  value,
  onChange,
  language,
  ariaLabel,
  placeholder,
  selectEndLabel,
  clearLabel,
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const locale = language === 'th' ? th : enUS;
  const dateFormatter = new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const label = value?.from
    ? `${dateFormatter.format(value.from)} – ${value.to ? dateFormatter.format(value.to) : selectEndLabel}`
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={ariaLabel}
          className={cn(
            'min-h-11 w-full justify-start text-left text-control font-normal tabular-nums [@media(pointer:coarse)]:text-field sm:w-auto sm:min-w-64',
            className,
          )}
        >
          <CalendarDays data-icon="inline-start" aria-hidden="true" />
          <span className={cn('truncate', !value?.from && 'text-muted-foreground')}>{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        role="dialog"
        aria-label={ariaLabel}
        align="start"
        className="w-auto p-0"
      >
        <Calendar
          mode="range"
          defaultMonth={value?.from ?? value?.to}
          selected={value}
          onSelect={(nextRange, triggerDate) => {
            if (!value?.from || value.to) {
              onChange({ from: triggerDate, to: undefined });
              return;
            }
            onChange(nextRange);
            if (nextRange?.from && nextRange.to) setOpen(false);
          }}
          locale={locale}
          numberOfMonths={1}
          autoFocus
        />
        {value?.from || value?.to ? (
          <div className="flex justify-end border-t border-border p-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
              <X data-icon="inline-start" aria-hidden="true" />
              {clearLabel}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

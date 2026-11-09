import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  anchorFor,
  filterSearchOptions,
  nextEnabledIndex,
  type ListAnchor,
  type SearchOption,
} from './searchSelectOptions';

export type SearchSelectProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  emptyText: string;
  clearLabel: string;
  ariaLabel?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'false' | 'true';
  disabled?: boolean;
  className?: string;
  /** ตัดบรรทัดแทนการตัดท้าย — ใช้เมื่อท้ายป้ายมีเหตุผลที่ตัวเลือกถูกปิด ซึ่งต้องอ่านได้ */
  wrapOptions?: boolean;
};

export function SearchSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  emptyText,
  clearLabel,
  ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  disabled,
  className,
  wrapOptions = false,
}: SearchSelectProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [anchor, setAnchor] = useState<ListAnchor | null>(null);

  const selected = options.find((option) => option.value === value) ?? null;
  const visible = useMemo(() => filterSearchOptions(options, query), [options, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const measure = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    setAnchor(anchorFor(el.getBoundingClientRect(), window.innerHeight));
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  const commit = (option: SearchOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(nextEnabledIndex(visible, -1, 1));
        return;
      }
      setActiveIndex(nextEnabledIndex(visible, activeIndex, event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'Enter' && open) {
      const option = visible[activeIndex];
      if (option) {
        event.preventDefault();
        commit(option);
      }
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setQuery('');
      }
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <Input
        id={id}
        ref={inputRef}
        role="combobox"
        type="text"
        autoComplete="off"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
        }
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : (selected?.label ?? '')}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="min-h-11 pr-20 [@media(pointer:fine)]:pr-16"
      />

      <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-2 pr-2 [@media(pointer:fine)]:gap-1">
        {selected ? (
          <button
            type="button"
            aria-label={clearLabel}
            onClick={() => {
              onChange('');
              setQuery('');
              inputRef.current?.focus();
            }}
            className="pointer-events-auto inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [@media(pointer:fine)]:size-8"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
        <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
      </span>

      {open ? (
        createPortal(
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          style={{
            pointerEvents: 'auto',
            ...(anchor
              ? {
                  top: anchor.top,
                  left: anchor.left,
                  width: anchor.width,
                  maxHeight: anchor.maxHeight,
                  transform: anchor.placement === 'up' ? 'translateY(-100%)' : undefined,
                }
              :
                { visibility: 'hidden' as const }),
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          className={cn(
            'pointer-events-auto fixed z-popover overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md',
            anchor?.placement === 'up' ? '-mt-1' : 'mt-1',
          )}
        >
          {visible.length === 0 ? (
            <li className="px-3 py-2 text-caption text-muted-foreground">{emptyText}</li>
          ) : (
            visible.map((option, index) => (
              <li
                key={option.value}
                className={cn(
                  option.disabled && 'text-muted-foreground',
                  index === activeIndex && !option.disabled && 'text-accent-foreground',
                )}
              >
                <button
                  type="button"
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled}
                  disabled={option.disabled}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => commit(option)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-control [@media(pointer:fine)]:min-h-9',
                    option.disabled ? 'cursor-not-allowed' : 'cursor-pointer',
                    index === activeIndex && !option.disabled && 'bg-accent',
                  )}
                >
                  <Check
                    aria-hidden="true"
                    className={cn(
                      'size-3.5 shrink-0',
                      option.value === value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1',
                      wrapOptions ? 'whitespace-normal break-words py-1.5' : 'truncate',
                    )}
                  >
                    {option.label}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>,
        document.body,
        )
      ) : null}
    </div>
  );
}

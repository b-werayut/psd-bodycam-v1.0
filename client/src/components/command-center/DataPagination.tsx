import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';

type PaginationItem = number | 'gap';

function paginationItems(page: number, pageCount: number): PaginationItem[] {
  const total = Math.max(1, Math.floor(pageCount));
  const current = Math.min(Math.max(Math.floor(page) || 1, 1), total);
  const range = (from: number, to: number): number[] =>
    Array.from({ length: to - from + 1 }, (_, index) => from + index);

  if (total <= 7) return range(1, total);

  const left = Math.max(current - 1, 1);
  const right = Math.min(current + 1, total);
  const hasLeftGap = left > 2;
  const hasRightGap = right < total - 1;

  if (!hasLeftGap) return [...range(1, 5), 'gap', total];
  if (!hasRightGap) return [1, 'gap', ...range(total - 4, total)];
  return [1, 'gap', ...range(left, right), 'gap', total];
}

export function DataPagination({
  page,
  pageCount,
  label,
  navigationLabel,
  onPageChange,
  disabled = false,
}: {
  page: number;
  pageCount: number;
  label: string;
  navigationLabel?: string;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const total = Math.max(1, Math.floor(pageCount));
  const current = Math.min(Math.max(Math.floor(page) || 1, 1), total);
  const isFirstPage = current === 1;
  const isLastPage = current === total;
  const controlClassName =
    'size-9 rounded-lg p-0 tabular-nums [@media(pointer:coarse)]:size-11';
  const goToPage = (nextPage: number) =>
    onPageChange(Math.min(Math.max(nextPage, 1), total));

  return (
    <nav
      aria-label={navigationLabel ?? t('common.pagination', { label })}
      className="flex flex-wrap items-center gap-1"
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('common.pagination.firstPage', { label })}
        title={t('common.pagination.firstPage', { label })}
        disabled={disabled || isFirstPage}
        onClick={() => goToPage(1)}
        className={controlClassName}
      >
        <ChevronsLeft data-icon="inline-start" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('common.pagination.previousPage', { label })}
        title={t('common.pagination.previousPage', { label })}
        disabled={disabled || isFirstPage}
        onClick={() => goToPage(current - 1)}
        className={controlClassName}
      >
        <ChevronLeft data-icon="inline-start" aria-hidden="true" />
      </Button>
      {paginationItems(current, total).map((item, index) =>
        item === 'gap' ? (
          <span
            key={`gap-${index}`}
            aria-hidden="true"
            className="flex size-9 items-center justify-center text-xs text-muted-foreground [@media(pointer:coarse)]:size-11"
          >
            …
          </span>
        ) : (
          <Button
            key={item}
            type="button"
            variant={item === current ? 'default' : 'outline'}
            size="icon"
            aria-label={t('common.pagination.goToPage', { page: item, label })}
            aria-current={item === current ? 'page' : undefined}
            disabled={disabled}
            onClick={() => goToPage(item)}
            className={controlClassName}
          >
            {item}
          </Button>
        ),
      )}
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('common.pagination.nextPage', { label })}
        title={t('common.pagination.nextPage', { label })}
        disabled={disabled || isLastPage}
        onClick={() => goToPage(current + 1)}
        className={controlClassName}
      >
        <ChevronRight data-icon="inline-start" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={t('common.pagination.lastPage', { label })}
        title={t('common.pagination.lastPage', { label })}
        disabled={disabled || isLastPage}
        onClick={() => goToPage(total)}
        className={controlClassName}
      >
        <ChevronsRight data-icon="inline-start" aria-hidden="true" />
      </Button>
    </nav>
  );
}

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Search } from 'lucide-react';

import {
  AsyncState,
  DataPagination,
  DataTableFrame,
  DataToolbar,
  PageHeader,
  StatusBadge,
  ToolButton,
} from '@/components/command-center';
import { actionToast } from '@/components/ui/action-toast';
import {
  DateRangePicker,
  dateRangeFromStrings,
  dateRangeToStrings,
} from '@/components/ui/calendar-range-select';
import { Input } from '@/components/ui/input';
import { SearchSelect } from '@/components/ui/search-select';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLanguage } from '@/i18n/useLanguage';
import { queryErrorDescription } from '@/lib/queryErrorCopy';
import { dayBoundsBangkok, formatDateTime } from '@/lib/time';
import { AUDIT_RESULT, auditApi } from './audit.api';

const PAGE_SIZE = 50;

/** Picker days are Bangkok calendar days. Empty or unparseable = no bound. */
function bangkokBound(date: string, edge: 'from' | 'to'): string | undefined {
  if (!date) return undefined;
  try {
    return dayBoundsBangkok(date)[edge];
  } catch {
    return undefined;
  }
}

export function AuditLogsPage() {
  const { t, language } = useLanguage();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = search.trim();
      setQ((prev) => {
        if (prev !== next) setPage(1);
        return next;
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  const filters = {
    page,
    pageSize: PAGE_SIZE,
    search: q || undefined,
    action: action || undefined,
    result: result ? Number(result) : undefined,
    from: bangkokBound(dateFrom, 'from'),
    to: bangkokBound(dateTo, 'to'),
  };
  const filtered = Boolean(q || action || result || dateFrom || dateTo);

  const query = useQuery({
    queryKey: ['audit-logs', 'list', filters],
    queryFn: () => auditApi.list(filters),
  });
  const actions = useQuery({ queryKey: ['audit-logs', 'actions'], queryFn: auditApi.actions });

  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const copyCorrelation = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      actionToast.success(t('audit.copiedToast'), id);
    } catch {
      actionToast.error(t('audit.copyFailedToast'), id);
    }
  };

  const asyncCopy = {
    loadingLabel: t('common.loading'),
    emptyTitle: t('audit.empty'),
    filteredEmptyTitle: t('audit.filteredEmpty'),
    filteredEmptyDescription: t('audit.filteredEmptyHint'),
    errorTitle: t('common.loadFailed'),
    errorDescription: queryErrorDescription(query.error, t),
    retryLabel: t('common.retry'),
  };

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
      <PageHeader title={t('audit.title')} description={t('audit.description')} />

      <DataToolbar label={t('audit.toolbar')}>
        <div className="relative w-full min-w-0 sm:max-w-xs">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t('audit.search')}
            placeholder={t('audit.searchPlaceholder')}
            className="min-h-11 pl-9"
          />
        </div>
        <SearchSelect
          id="audit-action"
          value={action}
          onChange={(next) => {
            setAction(next);
            setPage(1);
          }}
          options={(actions.data ?? []).map((a) => ({ value: a, label: a }))}
          ariaLabel={t('audit.filter.action')}
          placeholder={t('audit.filter.allActions')}
          emptyText={t('common.pickerNotFound')}
          clearLabel={t('common.pickerClear')}
          className="w-full sm:w-52"
        />
        <div className="w-full sm:w-40">
          <Select
            aria-label={t('audit.filter.result')}
            value={result}
            onChange={(event) => {
              setResult(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('audit.filter.allResults')}</option>
            <option value={String(AUDIT_RESULT.SUCCESS)}>{t('audit.result.success')}</option>
            <option value={String(AUDIT_RESULT.FAILURE)}>{t('audit.result.failure')}</option>
          </Select>
        </div>
        <DateRangePicker
          value={dateRangeFromStrings(dateFrom, dateTo)}
          onChange={(range) => {
            const next = dateRangeToStrings(range);
            setDateFrom(next.dateFrom);
            setDateTo(next.dateTo);
            setPage(1);
          }}
          language={language}
          ariaLabel={t('common.dateRange.label')}
          placeholder={t('common.dateRange.placeholder')}
          selectEndLabel={t('common.dateRange.selectEnd')}
          clearLabel={t('common.dateRange.clear')}
        />
      </DataToolbar>

      <DataTableFrame
        label={t('audit.tableCaption')}
        footer={
          <>
            <p aria-live="polite">
              {t('audit.summary', { shown: rows.length, total, page, pages: pageCount })}
            </p>
            {!query.isPending && !query.isError && total > 0 ? (
              <DataPagination
                page={page}
                pageCount={pageCount}
                label={t('audit.tableCaption')}
                onPageChange={setPage}
                disabled={query.isFetching}
              />
            ) : null}
          </>
        }
      >
        {query.isPending ? (
          <AsyncState state="loading" {...asyncCopy} />
        ) : query.isError ? (
          <AsyncState state="error" {...asyncCopy} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <AsyncState state={filtered ? 'filtered-empty' : 'empty'} {...asyncCopy} />
        ) : (
          <Table className="min-w-[1100px]">
            <TableCaption className="sr-only">{t('audit.tableCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('audit.column.occurredAt')}</TableHead>
                <TableHead>{t('audit.column.actor')}</TableHead>
                <TableHead>{t('audit.column.action')}</TableHead>
                <TableHead>{t('audit.column.request')}</TableHead>
                <TableHead>{t('audit.column.result')}</TableHead>
                <TableHead>{t('audit.column.ip')}</TableHead>
                <TableHead>{t('audit.column.correlationId')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {formatDateTime(log.occurredAt, language, { seconds: true })}
                  </TableCell>
                  <TableCell className="text-sm">
                    {log.actorUsername ?? (
                      <span className="text-muted-foreground">{t('audit.unknownActor')}</span>
                    )}
                    {log.actorRole ? (
                      <span className="block text-xs text-muted-foreground">{log.actorRole}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {log.action}
                    {log.resourceType ? (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {log.resourceType}
                        {log.resourceId ? ` #${log.resourceId}` : ''}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {log.httpMethod ? `${log.httpMethod} ` : ''}
                    {log.requestPath ?? '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={log.result === AUDIT_RESULT.SUCCESS ? 'success' : 'destructive'}
                    >
                      {t(
                        log.result === AUDIT_RESULT.SUCCESS
                          ? 'audit.result.success'
                          : 'audit.result.failure',
                      )}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{log.ip ?? '—'}</TableCell>
                  <TableCell>
                    {log.correlationId ? (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs">{log.correlationId}</span>
                        <ToolButton
                          tone="neutral"
                          aria-label={t('audit.copyCorrelation', { id: log.correlationId })}
                          title={t('audit.copyCorrelation', { id: log.correlationId })}
                          onClick={() => void copyCorrelation(log.correlationId as string)}
                        >
                          <Copy aria-hidden="true" />
                        </ToolButton>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataTableFrame>
    </div>
  );
}

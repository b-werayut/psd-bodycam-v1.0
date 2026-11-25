import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Eye, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  AsyncState,
  DataPagination,
  DataTableFrame,
  DataToolbar,
  PageHeader,
  StatusBadge,
  ToolButton,
} from '@/components/command-center';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { TranslationKey } from '@/i18n/locales/th';
import { useLanguage } from '@/i18n/useLanguage';
import { queryErrorDescription } from '@/lib/queryErrorCopy';
import { formatTime } from '@/lib/time';
import { WorkOrderCameraList } from './WorkOrderCameraList';
import { WorkOrderDetailDialog } from './WorkOrderDetailDialog';
import { workOrdersApi, type WorkOrderRow, type WorkOrderStatus } from './workOrders.api';
import { useWorkOrderLiveRefresh } from './useWorkOrderLiveRefresh';
import { useWorkOrderLiveWatch } from './useWorkOrderLiveWatch';
import { workOrderStatusView, workWindowText } from './workOrderView';

const PAGE_SIZE = 20;

const TABS: { value: string; labelKey: TranslationKey }[] = [
  { value: '', labelKey: 'workOrders.tab.all' },
  { value: '6', labelKey: 'workOrders.status.planned' },
  { value: '1', labelKey: 'workOrders.status.open' },
  { value: '2', labelKey: 'workOrders.status.closed' },
  { value: '3', labelKey: 'workOrders.status.cancelled' },
];

function parseStatus(value: string | null): WorkOrderStatus | undefined {
  return value === '1' || value === '2' || value === '3' || value === '6'
    ? (Number(value) as WorkOrderStatus)
    : undefined;
}

export function WorkOrdersPage() {
  const { t, language } = useLanguage();
  const [openWorkOrder, setOpenWorkOrder] = useState<WorkOrderRow | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const openDetail = (row: WorkOrderRow, trigger: HTMLButtonElement) => {
    returnFocusRef.current = trigger;
    setOpenWorkOrder(row);
  };
  const [params, setParams] = useSearchParams();
  useWorkOrderLiveRefresh();
  // one live dialog for every row and the detail dialog; it lives here so refetches, tabs and paging cannot unmount it
  const { onWatch, liveDialog } = useWorkOrderLiveWatch();

  const status = parseStatus(params.get('status'));
  const q = (params.get('q') ?? '').trim();
  const [search, setSearch] = useState(q);
  // q changed from outside (menu click to /work-orders, browser Back/Forward): the box follows it, or the
  // pause below would write the old text back. Our own write already matches what is typed, so typing
  // is never overwritten.
  const [seenQ, setSeenQ] = useState(q);
  if (q !== seenQ) {
    setSeenQ(q);
    if (search.trim() !== q) setSearch(q);
  }
  // the page belongs to one filter: a changed status/q (tab, search, browser back/forward) starts at page 1
  const filterKey = `${status ?? ''}|${q}`;
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (next: number) => setPageState({ key: filterKey, page: next });

  // typed text reaches the URL (and the query) after a pause
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = search.trim();
      if (next === q) return;
      setParams(
        (prev) => {
          const copy = new URLSearchParams(prev);
          if (next) copy.set('q', next);
          else copy.delete('q');
          return copy;
        },
        { replace: true },
      );
    }, 300);
    return () => window.clearTimeout(handle);
  }, [search, q, setParams]);

  const setStatus = (value: string) => {
    setParams((prev) => {
      const copy = new URLSearchParams(prev);
      if (value) copy.set('status', value);
      else copy.delete('status');
      return copy;
    });
  };

  const filters = {
    ...(status ? { status } : {}),
    ...(q ? { q } : {}),
    page,
    pageSize: PAGE_SIZE,
  };
  const filtered = Boolean(status || q);

  const query = useQuery({
    queryKey: ['work-orders', 'list', filters],
    queryFn: () => workOrdersApi.list(filters),
    placeholderData: keepPreviousData,
  });

  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // a refresh can shrink the list below the current page: step back instead of showing an empty page
  const beyondLastPage = Boolean(query.data) && !query.isPlaceholderData && page > pageCount;
  useEffect(() => {
    if (beyondLastPage) setPageState({ key: filterKey, page: pageCount });
  }, [beyondLastPage, filterKey, pageCount]);

  const fetchedAt = rows
    .flatMap((r) => r.cameras.map((c) => c.platformStatusFetchedAt))
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop();

  const asyncCopy = {
    loadingLabel: t('common.loading'),
    emptyTitle: t('workOrders.empty'),
    filteredEmptyTitle: t('workOrders.filteredEmpty'),
    filteredEmptyDescription: t('workOrders.filteredEmptyHint'),
    errorTitle: t('common.loadFailed'),
    errorDescription: queryErrorDescription(query.error, t),
    retryLabel: t('common.retry'),
  };

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
      <PageHeader title={t('workOrders.title')} description={t('workOrders.description')} />

      <DataToolbar label={t('workOrders.toolbar')}>
        <Tabs value={status ? String(status) : ''} onValueChange={setStatus} className="max-w-full">
          <div className="max-w-full overflow-x-auto">
            <TabsList aria-label={t('workOrders.tabs')}>
              {TABS.map((tab) => (
                <TabsTrigger key={tab.value || 'all'} value={tab.value}>
                  {t(tab.labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
        <div className="relative w-full min-w-0 sm:max-w-xs">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t('workOrders.search')}
            placeholder={t('workOrders.searchPlaceholder')}
            className="min-h-11 pl-9"
          />
        </div>
      </DataToolbar>

      <DataTableFrame
        label={t('workOrders.tableCaption')}
        footer={
          <>
            <p aria-live="polite">
              {t('workOrders.summary', { shown: rows.length, total, page, pages: pageCount })}
              {fetchedAt
                ? ` · ${t('workOrders.camera.fetchedAt', { time: formatTime(fetchedAt, language) })}`
                : ''}
            </p>
            {!query.isPending && !query.isError && total > 0 ? (
              <DataPagination
                page={page}
                pageCount={pageCount}
                label={t('workOrders.tableCaption')}
                onPageChange={setPage}
                disabled={query.isFetching}
              />
            ) : null}
          </>
        }
      >
        {query.isPending || beyondLastPage ? (
          <AsyncState state="loading" {...asyncCopy} />
        ) : query.isError ? (
          <AsyncState state="error" {...asyncCopy} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <AsyncState state={filtered ? 'filtered-empty' : 'empty'} {...asyncCopy} />
        ) : (
          <Table className="min-w-[1000px]">
            <TableCaption className="sr-only">{t('workOrders.tableCaption')}</TableCaption>
            <TableHeader className="[&_th]:bg-muted">
              <TableRow>
                <TableHead>{t('workOrders.column.workOrder')}</TableHead>
                <TableHead>{t('workOrders.column.refs')}</TableHead>
                <TableHead>{t('workOrders.column.status')}</TableHead>
                <TableHead>{t('workOrders.column.window')}</TableHead>
                <TableHead>{t('workOrders.column.team')}</TableHead>
                <TableHead>{t('workOrders.column.cameras')}</TableHead>
                <TableHead className="sticky right-0 z-20 w-px whitespace-nowrap bg-muted text-right">
                  {t('workOrders.column.tools')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const view = workOrderStatusView(row.status);
                const window = workWindowText(row, language);
                return (
                  <TableRow
                    key={row.id}
                    className="group align-top"
                  >
                    <TableCell className="text-sm">
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        onClick={(event) => openDetail(row, event.currentTarget)}
                        aria-label={t('workOrders.openRow', { no: row.workOrderNo })}
                        className="work-order-id text-xs font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.workOrderNo}
                      </button>
                      <span className="mt-0.5 block text-sm font-medium">{row.title}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.booking.externalJobNo ? (
                        <span className="block">
                          {t('workOrders.bookingNo', { no: row.booking.externalJobNo })}
                        </span>
                      ) : null}
                      {row.booking.doNo ? (
                        <span className="block">{t('workOrders.doNo', { no: row.booking.doNo })}</span>
                      ) : null}
                      {row.booking.shNo ? (
                        <span className="block">{t('workOrders.shNo', { no: row.booking.shNo })}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge tone={view.tone}>{t(view.labelKey)}</StatusBadge>
                        {row.needsReview ? (
                          <StatusBadge tone="warning">{t('workOrders.needsReview')}</StatusBadge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{t(window.key, window.params)}</TableCell>
                    <TableCell className="text-sm">
                      {row.team?.name ?? (
                        <span className="text-muted-foreground">{t('workOrders.noTeam')}</span>
                      )}
                      {row.leader ? (
                        <span className="block text-xs text-muted-foreground">
                          {t('workOrders.leader', { name: row.leader.name })}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <WorkOrderCameraList cameras={row.cameras} onWatch={onWatch} />
                    </TableCell>
                    <TableCell className="sticky right-0 z-10 w-px whitespace-nowrap bg-card text-right transition-colors group-hover:bg-muted/50">
                      <ToolButton type="button" tone="view" aria-haspopup="dialog"
                        aria-label={t('workOrders.viewDetail', { no: row.workOrderNo })}
                        title={t('workOrders.viewDetail', { no: row.workOrderNo })}
                        onClick={(event) => openDetail(row, event.currentTarget)}>
                        <Eye aria-hidden="true" />
                      </ToolButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DataTableFrame>
      <WorkOrderDetailDialog workOrder={openWorkOrder} onClose={() => setOpenWorkOrder(null)} returnFocusRef={returnFocusRef} onWatch={onWatch} />
      {liveDialog}
    </div>
  );
}

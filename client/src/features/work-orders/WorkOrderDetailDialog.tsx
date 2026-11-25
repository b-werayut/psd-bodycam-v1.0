import { useRef, type ComponentProps, type RefObject } from 'react';

import { AsyncState } from '@/components/command-center';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import { queryErrorDescription } from '@/lib/queryErrorCopy';
import { WorkOrderDetailContent, WorkOrderDetailStatus } from './WorkOrderDetailContent';
import { useWorkOrderDetail } from './useWorkOrderDetail';
import type { WorkOrderRow } from './workOrders.api';
import { workWindowText } from './workOrderView';

type WatchHandler = ComponentProps<typeof WorkOrderDetailContent>['onWatch'];

function Detail({ workOrder, headingRef, onClose, onWatch }: {
  workOrder: WorkOrderRow;
  headingRef: RefObject<HTMLHeadingElement>;
  onClose: () => void;
  onWatch?: WatchHandler;
}) {
  const { t, language } = useLanguage();
  const query = useWorkOrderDetail(workOrder.id);
  const wo = query.data;
  const window = wo ? workWindowText(wo, language) : null;
  const notFound = query.isError && apiErrorOf(query.error, t).status === 404;
  const asyncCopy = {
    loadingLabel: t('common.loading'), emptyTitle: t('workOrders.detail.notFound'),
    filteredEmptyTitle: t('workOrders.detail.notFound'), errorTitle: t('common.loadFailed'), retryLabel: t('common.retry'),
  };

  return <>
    <DialogHeader className="shrink-0 gap-2 border-b border-border bg-muted/30 px-5 py-5 sm:px-6">
      <DialogTitle ref={headingRef} tabIndex={-1} className="text-pretty pr-2 text-heading outline-none [overflow-wrap:anywhere]">
        {wo?.title ?? workOrder.title}
      </DialogTitle>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <DialogDescription className="work-order-id font-semibold">{wo?.workOrderNo ?? workOrder.workOrderNo}</DialogDescription>
        {wo ? <div className="border-l border-border pl-3"><WorkOrderDetailStatus workOrder={wo} /></div> : null}
        {window ? <span className="border-l border-border pl-3 text-xs text-muted-foreground">{t(window.key, window.params)}</span> : null}
      </div>
    </DialogHeader>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain lg:overflow-hidden">
      {query.isPending ? <AsyncState state="loading" {...asyncCopy} className="m-5 sm:m-6" /> : query.isError ? (
        <AsyncState state={notFound ? 'empty' : 'error'} {...asyncCopy} className="m-5 sm:m-6"
          emptyTitle={t('workOrders.detail.notFound')} emptyDescription={t('workOrders.detail.notFoundHint')}
          emptyAction={<Button variant="outline" onClick={onClose}>{t('common.close')}</Button>}
          errorTitle={t('common.loadFailed')} errorDescription={queryErrorDescription(query.error, t)}
          retryLabel={t('common.retry')} onRetry={() => void query.refetch()} />
      ) : <WorkOrderDetailContent workOrder={query.data} inDialog onWatch={onWatch} />}
    </div>
  </>;
}

export function WorkOrderDetailDialog({ workOrder, onClose, returnFocusRef, onWatch }: {
  workOrder: WorkOrderRow | null;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement>;
  onWatch?: WatchHandler;
}) {
  const { t } = useLanguage();
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <Dialog open={workOrder !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent closeLabel={t('common.close')}
        className="h-[92dvh] gap-0 overflow-hidden p-0 sm:h-[calc(100dvh-3rem)] sm:max-h-[56rem] sm:w-[calc(100vw-3rem)] sm:max-w-6xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          headingRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocusRef.current?.isConnected) {
            event.preventDefault();
            returnFocusRef.current.focus();
          }
        }}>
        {workOrder ? <Detail key={workOrder.id} workOrder={workOrder} headingRef={headingRef} onClose={onClose} onWatch={onWatch} /> : null}
      </DialogContent>
    </Dialog>
  );
}

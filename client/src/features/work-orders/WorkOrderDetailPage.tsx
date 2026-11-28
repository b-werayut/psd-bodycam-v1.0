import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { AsyncState, PageHeader } from '@/components/command-center';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import { queryErrorDescription } from '@/lib/queryErrorCopy';
import { WorkOrderDetailContent, WorkOrderDetailStatus } from './WorkOrderDetailContent';
import { useWorkOrderDetail } from './useWorkOrderDetail';
import { useWorkOrderLiveWatch } from './useWorkOrderLiveWatch';
import { workWindowText } from './workOrderView';

/** Kept for existing direct links; opening an order from the list uses the detail dialog. */
export function WorkOrderDetailPage() {
  const { t, language } = useLanguage();
  const { id = '' } = useParams();
  const query = useWorkOrderDetail(id);
  const { onWatch, liveDialog } = useWorkOrderLiveWatch();
  const asyncCopy = {
    loadingLabel: t('common.loading'), emptyTitle: t('workOrders.detail.notFound'),
    filteredEmptyTitle: t('workOrders.detail.notFound'), errorTitle: t('common.loadFailed'), retryLabel: t('common.retry'),
  };
  const backLink = <Button asChild variant="outline" className="min-h-11">
    <Link to="/work-orders"><ArrowLeft aria-hidden="true" className="size-4" />{t('workOrders.detail.back')}</Link>
  </Button>;
  const body = (): ReactNode => {
    if (query.isPending) return <AsyncState state="loading" {...asyncCopy} />;
    if (query.isError) {
      if (apiErrorOf(query.error, t).status === 404) return <AsyncState state="empty" {...asyncCopy}
        emptyTitle={t('workOrders.detail.notFound')} emptyDescription={t('workOrders.detail.notFoundHint')} emptyAction={backLink} />;
      return <AsyncState state="error" {...asyncCopy}
        errorDescription={queryErrorDescription(query.error, t)} retryLabel={t('common.retry')}
        onRetry={() => void query.refetch()} />;
    }
    const wo = query.data;
    const window = workWindowText(wo, language);
    return <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <PageHeader title={`${wo.workOrderNo} · ${wo.title}`} description={t(window.key, window.params)}
        meta={<WorkOrderDetailStatus workOrder={wo} />} actions={backLink} />
      <WorkOrderDetailContent workOrder={wo} onWatch={onWatch} />
    </div>;
  };
  // the live dialog sits outside the loading / error branches, so a refetch cannot hang up the call
  return <>{body()}{liveDialog}</>;
}

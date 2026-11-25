import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useId, type ComponentProps, type ReactNode } from 'react';

import { AsyncState, StatusBadge } from '@/components/command-center';
import type { TranslationKey } from '@/i18n/locales/th';
import { useLanguage } from '@/i18n/useLanguage';
import { queryErrorDescription } from '@/lib/queryErrorCopy';
import { formatDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { WorkOrderCameraList } from './WorkOrderCameraList';
import { workOrdersApi, type WorkOrderDetail, type WorkOrderEvent } from './workOrders.api';
import { workOrderStatusView } from './workOrderView';

const WorkOrderSiteMap = lazy(() => import('./WorkOrderSiteMap').then((module) => ({ default: module.WorkOrderSiteMap })));

/** Blueprint Part 4 ReviewReasons; source-neutral copy (DL64). */
const REVIEW_REASON_KEYS: Record<number, TranslationKey> = {
  1: 'workOrders.detail.reviewReason.1',
  2: 'workOrders.detail.reviewReason.2',
  3: 'workOrders.detail.reviewReason.3',
  4: 'workOrders.detail.reviewReason.4',
  5: 'workOrders.detail.reviewReason.5',
  6: 'workOrders.detail.reviewReason.6',
};

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-3 sm:grid-cols-[7.5rem_minmax(0,1fr)]', className)}>
      <dt className="text-sm leading-5 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm leading-5 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function DetailSection({ title, children, className, actions }: {
  title: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  const id = useId();
  return <section role="region" aria-labelledby={id} className={cn('min-w-0', className)}>
    <div className="flex items-baseline justify-between gap-3">
      <h3 id={id} className="text-subheading font-semibold">{title}</h3>
      {actions}
    </div>
    <div className="mt-3">{children}</div>
  </section>;
}

export function WorkOrderDetailStatus({ workOrder }: { workOrder: WorkOrderDetail }) {
  const { t } = useLanguage();
  const view = workOrderStatusView(workOrder.status);
  return <div className="flex flex-wrap items-center gap-2">
    <StatusBadge tone={view.tone}>{t(view.labelKey)}</StatusBadge>
    {workOrder.needsReview ? <StatusBadge tone="warning">{t('workOrders.needsReview')}</StatusBadge> : null}
    {workOrder.reviewReasons.map((reason) => REVIEW_REASON_KEYS[reason] ? (
      <span key={reason} className="text-xs text-muted-foreground">{t(REVIEW_REASON_KEYS[reason])}</span>
    ) : null)}
  </div>;
}

export function WorkOrderDetailContent({ workOrder: wo, inDialog = false, onWatch }: {
  workOrder: WorkOrderDetail;
  inDialog?: boolean;
  onWatch?: ComponentProps<typeof WorkOrderCameraList>['onWatch'];
}) {
  const { t, language } = useLanguage();
  const eventsQuery = useQuery({
    queryKey: ['work-orders', 'events', wo.id],
    queryFn: () => workOrdersApi.events(wo.id),
  });
  const asyncCopy = {
    loadingLabel: t('common.loading'), emptyTitle: t('workOrders.detail.noEvents'),
    filteredEmptyTitle: t('workOrders.detail.noEvents'), errorTitle: t('common.loadFailed'), retryLabel: t('common.retry'),
  };
  const booking = wo.booking;
  const full = booking.detail ? booking : null;
  const none = t('workOrders.detail.empty');
  const dt = (value: string | null) => value ? formatDateTime(value, language) : none;
  const lat = full?.site.lat;
  const lng = full?.site.lng;
  const point: [number, number] | null = typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
  const statusLabel = (s: number | null) => (s === null ? none : t(workOrderStatusView(s).labelKey));

  const eventText = (e: WorkOrderEvent) => {
    if (e.eventType === 1) return t('workOrders.event.created');
    if (e.eventType === 2)
      return t('workOrders.event.statusChanged', {
        from: statusLabel(e.fromStatus),
        to: statusLabel(e.toStatus),
      });
    return t('workOrders.event.other');
  };
  const events = eventsQuery.data ?? [];
  const mapHeadingId = useId();

  const planned = booking.plannedStartAt
    ? booking.plannedEndAt
      ? t('workOrders.detail.plannedRange', {
          from: formatDateTime(booking.plannedStartAt, language),
          to: formatDateTime(booking.plannedEndAt, language),
        })
      : t('workOrders.detail.plannedFrom', { from: formatDateTime(booking.plannedStartAt, language) })
    : none;

  return (
    <div className={cn('grid min-h-0 min-w-0', full && 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]', inDialog && 'lg:h-full')}>
      <div className={cn('min-w-0 space-y-5 p-5 sm:p-6', inDialog && 'lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain')}>
        <DetailSection title={t('workOrders.detail.job')}>
          <dl className="space-y-1.5">
            <Field label={t('workOrders.detail.field.site')}>{full ? full.site.name ?? none : booking.detail ? none : booking.siteName ?? none}</Field>
            {full ? <Field label={t('workOrders.detail.field.address')}>{full.site.address ?? none}</Field> : null}
            <Field label={t('workOrders.detail.field.team')}>
              {wo.team?.name ?? t('workOrders.noTeam')}
              {wo.leader ? <span className="mt-0.5 block text-xs text-muted-foreground">{t('workOrders.leader', { name: wo.leader.name })}</span> : null}
            </Field>
            <Field label={t('workOrders.detail.field.planned')}>{planned}</Field>
            {full ? <>
              <Field label={t('workOrders.detail.field.checkIn')}>{dt(full.checkInAt)}</Field>
              <Field label={t('workOrders.detail.field.checkOut')}>{dt(full.checkOutAt)}</Field>
            </> : null}
          </dl>
          <dl className="mt-4 space-y-1.5">
            <Field label={t('workOrders.detail.field.bookingNo')}>{booking.externalJobNo ?? none}</Field>
            <Field label={t('workOrders.detail.field.doNo')}>{booking.doNo ?? none}</Field>
            <Field label={t('workOrders.detail.field.shNo')}>{booking.shNo ?? none}</Field>
            {full ? <>
              <Field label={t('workOrders.detail.field.bookingRef')}>{full.externalJobId}</Field>
              <Field label={t('workOrders.detail.field.rawStatus')}>{full.rawStatus ?? none}</Field>
              <Field label={t('workOrders.detail.field.synced')}>{dt(full.lastSyncedAt)}</Field>
            </> : null}
          </dl>
        </DetailSection>

        {wo.note ? <DetailSection title={t('workOrders.detail.note')} className="border-t border-border pt-5">
          <p className="whitespace-pre-wrap break-words text-sm leading-6">{wo.note}</p>
        </DetailSection> : null}

        <DetailSection title={t('workOrders.detail.cameras')} className="border-t border-border pt-5"
          actions={<span className="text-xs tabular-nums text-muted-foreground">{t('workOrders.detail.cameraCount', { count: wo.cameras.length })}</span>}>
          <WorkOrderCameraList cameras={wo.cameras} detailed onWatch={onWatch} />
        </DetailSection>

        <DetailSection title={t('workOrders.detail.timeline')} className="border-t border-border pt-5">
          {eventsQuery.isPending ? <AsyncState state="loading" {...asyncCopy} /> : eventsQuery.isError ? (
            <AsyncState state="error" {...asyncCopy} errorDescription={queryErrorDescription(eventsQuery.error, t)}
              onRetry={() => void eventsQuery.refetch()} />
          ) : events.length === 0 ? <p className="text-sm text-muted-foreground">{t('workOrders.detail.noEvents')}</p> : (
            <ol className="space-y-3">
              {events.map((event, index) => (
                <li key={event.id} aria-label={t('workOrders.event.item', { n: index + 1 })}
                  className="flex items-start gap-3 text-sm leading-5">
                  <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  <div className="min-w-0 [overflow-wrap:anywhere]">
                    <time dateTime={event.occurredAt} className="mr-2 text-xs tabular-nums text-muted-foreground">{formatDateTime(event.occurredAt, language)}</time>
                    <span>{eventText(event)}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </DetailSection>
      </div>

      {full ? <section role="region" aria-labelledby={mapHeadingId}
        className="flex min-h-0 min-w-0 flex-col border-t border-border p-4 lg:border-l lg:border-t-0">
        <h3 id={mapHeadingId} className="sr-only">{t('workOrders.detail.siteMap')}</h3>
        {point ? <>
          <div className={cn('h-80 min-h-0 overflow-hidden rounded-md border border-border sm:h-96', inDialog ? 'lg:h-auto lg:flex-1' : 'lg:h-[36rem]')}>
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">{t('common.loading')}</div>}>
              <WorkOrderSiteMap point={point} name={full.site.name ?? t('workOrders.detail.field.site')} className="h-full" />
            </Suspense>
          </div>
          <div className="shrink-0 px-1 pt-3">
            {full.site.name ? <p className="break-words text-sm font-semibold">{full.site.name}</p> : null}
            <p className="nwl-mono mt-1 text-xs text-muted-foreground">{point[0].toFixed(6)}, {point[1].toFixed(6)}</p>
          </div>
        </> : <div className="flex min-h-64 flex-1 items-center justify-center rounded-md bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          {t('workOrders.detail.noCoordinates')}
        </div>}
      </section> : null}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { ListFilter, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { LoadingSkeleton } from '@/components/command-center/LoadingSkeleton';
import { MapCanvas } from '@/components/map/MapCanvas';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchSelect } from '@/components/ui/search-select';
import { loadCameraWorkOrders, workOrderDayRange as workOrderRange } from '@/features/evidence/evidenceWorkOrders';
import type { TranslationKey } from '@/i18n/locales/th';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import { formatDayMonth, formatTime } from '@/lib/time';
import { usePermission } from '@/lib/usePermission';
import { RouteLayers } from './components/RouteLayers';
import { TrackingViewSwitch } from '../tracking/components/TrackingViewSwitch';
import { VIEW_PARAM } from '../tracking/trackingView';
import { historyApi } from './history.api';
import {
  HISTORY_MAX_HOURS,
  bangkokDateOf,
  historySearch,
  parseHistoryQuery,
  rangeFieldsOf,
  rangeProblem,
  spansDays,
  windowOfFields,
  type HistoryWindow,
  type RangeFields,
  type RangeProblem,
} from './historyRange';
import { distanceText, timelineView } from './historyTimeline';

const PROBLEM_KEY: Record<RangeProblem, TranslationKey> = {
  incomplete: 'tracking.history.rangeIncomplete',
  endBeforeStart: 'tracking.history.rangeEndBeforeStart',
  tooLong: 'tracking.history.rangeTooLong',
  future: 'tracking.history.rangeFuture',
};
const EMPTY_RANGE: RangeFields = { startDate: '', startTime: '', endDate: '', endTime: '' };

/**
 * ประวัติเส้นทาง: choose a camera and a Bangkok start–end window of at most 36 h before searching.
 * The range fields filter work orders immediately; Show route or choosing a camera loads the route.
 */
/**
 * `viewSwitch`: shown as the history tab of แผนที่ติดตาม (with the ตำแหน่งปัจจุบัน | ประวัติเส้นทาง tabs).
 * The ประวัติเส้นทาง menu itself shows only the route history, with no tabs.
 */
export function HistoryPage({ viewSwitch = false }: { viewSwitch?: boolean } = {}) {
  const { t, language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseHistoryQuery(params), [params]);
  const hasLoadedRange = Date.parse(params.get('from') ?? '') === Date.parse(query.from)
    && Date.parse(params.get('to') ?? '') === Date.parse(query.to);
  const hasCamera = Boolean(query.deviceId);
  const today = bangkokDateOf(new Date());
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [draft, setDraft] = useState<RangeFields>(() => hasLoadedRange ? rangeFieldsOf(query) : EMPTY_RANGE);
  const context = query.deviceId;
  const [seen, setSeen] = useState(context);
  const [workOrderId, setWorkOrderId] = useState('');
  if (seen !== context) {
    setSeen(context);
    setWorkOrderId('');
  }
  // back / forward or a link changes the loaded window: the fields follow it
  useEffect(() => setDraft(hasLoadedRange ? rangeFieldsOf({ from: query.from, to: query.to }) : EMPTY_RANGE),
    [query.from, query.to, hasLoadedRange]);

  const draftWindow = windowOfFields(draft);
  const problem = rangeProblem(draftWindow);
  const edit = (edge: 'start' | 'end') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const [date = '', time = ''] = e.target.value.split('T');
    const wallTime = time.split('.')[0];
    setWorkOrderId('');
    setDraft((current) => edge === 'start'
      ? { ...current, startDate: date, startTime: wallTime }
      : { ...current, endDate: date, endTime: wallTime });
  };

  const devices = useQuery({ queryKey: ['tracking', 'history-devices'], queryFn: historyApi.devices });
  const device = devices.data?.find((item) => item.id === query.deviceId) ?? null;
  const canReadWorkOrders = usePermission('work-orders:read');
  const cameraWorkOrders = useQuery({
    queryKey: ['evidence', 'work-orders', query.deviceId],
    queryFn: () => loadCameraWorkOrders(query.deviceId!),
    enabled: device !== null && canReadWorkOrders && problem === null,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const workOrderWindow = draftWindow && problem === null
    ? { from: draftWindow.from, to: new Date(Math.min(Date.parse(draftWindow.to), Date.now())).toISOString() }
    : null;
  const availableWorkOrders = (cameraWorkOrders.data ?? []).filter((order) =>
    workOrderWindow !== null && order.cameras.some((camera) => camera.deviceId === query.deviceId)
      && workOrderRange(order, workOrderWindow) !== null);
  const chooseWorkOrder = (id: string) => {
    setWorkOrderId(id);
    const order = availableWorkOrders.find((item) => item.id === id);
    const range = order && workOrderWindow ? workOrderRange(order, workOrderWindow) : null;
    if (range) setDraft(rangeFieldsOf({ from: range.startAt, to: range.endAt }));
  };
  const history = useQuery({
    queryKey: ['tracking', 'history', query.deviceId, query.from, query.to],
    queryFn: () => historyApi.history(query.deviceId!, query.from, query.to),
    enabled: hasCamera && hasLoadedRange,
    // every request writes an audit row: never refetch on its own
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const go = (next: { deviceId?: string | null; window?: HistoryWindow }) => {
    setFocus(null);
    const window = next.window ?? (hasLoadedRange ? { from: query.from, to: query.to } : null);
    const deviceId = next.deviceId === undefined ? query.deviceId : next.deviceId;
    const search = window ? new URLSearchParams(historySearch({ deviceId, ...window })) : new URLSearchParams();
    if (window) setDraft(rangeFieldsOf(window));
    else if (deviceId) search.set('deviceId', deviceId);
    // opened as a tab of แผนที่ติดตาม (`?view=history`): stay in that view
    const view = params.get(VIEW_PARAM);
    if (view) search.set(VIEW_PARAM, view);
    setParams(search);
  };

  // valid fields that differ from what is loaded: the results below are not for them yet
  const pending =
    problem === null && draftWindow !== null && (!hasLoadedRange || draftWindow.from !== query.from || draftWindow.to !== query.to);
  const show = () => {
    if (!hasCamera || !draftWindow) return;
    if (pending) return go({ window: draftWindow });
    // same range again = an explicit retry / refresh (e.g. today so far) — a user action, audited like any load
    setFocus(null);
    if (query.deviceId) void history.refetch();
  };
  const clockOf = (iso: string) => {
    const second = new Date(iso).getUTCSeconds();
    return `${formatDayMonth(iso, language)} ${formatTime(iso, language)}${second ? `:${String(second).padStart(2, '0')}` : ''}`;
  };

  const route = hasLoadedRange ? history.data : undefined;
  const error = history.isError ? apiErrorOf(history.error, t).message : null;
  const stops = route?.timeline.filter((item) => item.kind === 'stop').length ?? 0;
  const withDate = spansDays(query);

  const renderPanel = (idPrefix: string) => (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <div className="flex shrink-0 flex-col gap-3 border-b border-border p-4">
        <div data-slot="history-heading">
          <p aria-hidden="true" className="text-title font-semibold">{t('navigation.trackingHistory')}</p>
          <p className="mt-1.5 text-caption leading-5 text-muted-foreground">{t('tracking.history.description')}</p>
        </div>
        {viewSwitch ? <TrackingViewSwitch current="history" /> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
      <div className="flex shrink-0 flex-col gap-3">
        <FieldGroup className="gap-2">
          <Field className="min-w-0">
            <FieldLabel htmlFor={`${idPrefix}-camera`}>{t('tracking.history.camera')}</FieldLabel>
            <SearchSelect id={`${idPrefix}-camera`} value={query.deviceId ?? ''}
              onChange={(value) => go({ deviceId: value || null, window: problem ? undefined : draftWindow! })}
              options={(devices.data ?? []).map((item) => ({ value: item.id,
                label: item.name && item.name !== item.deviceCode ? `${item.deviceCode} · ${item.name}` : item.deviceCode }))}
              placeholder={t('evidence.cameraPlaceholder')} emptyText={t('evidence.cameraNone')}
              clearLabel={t('common.pickerClear')} disabled={devices.isPending} />
          </Field>
        </FieldGroup>
        <div className="flex flex-col gap-3">
          <h2 id={`${idPrefix}-range-title`} className="text-control font-semibold">{t('tracking.history.rangeTitle')}</h2>
          <FieldGroup aria-labelledby={`${idPrefix}-range-title`} className="gap-3">
            <Field orientation="horizontal" data-disabled={!hasCamera} className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)]">
              <FieldLabel htmlFor={`${idPrefix}-from`}>{t('tracking.history.rangeStart')}</FieldLabel>
              <Input
                id={`${idPrefix}-from`}
                type="datetime-local"
                step={1}
                disabled={!hasCamera}
                value={draft.startDate && draft.startTime ? `${draft.startDate}T${draft.startTime}` : ''}
                max={`${today}T23:59:59`}
                onChange={edit('start')}
                className="relative min-w-0 max-w-full pr-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-3 [&::-webkit-calendar-picker-indicator]:m-0"
              />
            </Field>
            <Field orientation="horizontal" data-disabled={!hasCamera} className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)]">
              <FieldLabel htmlFor={`${idPrefix}-to`}>{t('tracking.history.rangeEnd')}</FieldLabel>
              <Input
                id={`${idPrefix}-to`}
                type="datetime-local"
                step={1}
                disabled={!hasCamera}
                value={draft.endDate && draft.endTime ? `${draft.endDate}T${draft.endTime}` : ''}
                onChange={edit('end')}
                className="relative min-w-0 max-w-full pr-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-3 [&::-webkit-calendar-picker-indicator]:m-0"
              />
            </Field>
          </FieldGroup>
          <Field className="min-w-0">
            <FieldLabel htmlFor={`${idPrefix}-work-order`}>{t('evidence.workOrder.label')}</FieldLabel>
            <SearchSelect id={`${idPrefix}-work-order`} value={workOrderId} onChange={chooseWorkOrder}
              options={availableWorkOrders.map((order) => ({ value: order.id, label: [order.workOrderNo, order.title].filter(Boolean).join(' · ') }))}
              wrapOptions placeholder={t(!device ? 'evidence.workOrder.pickCamera' : problem !== null ? 'tracking.history.workOrderPickRange' : cameraWorkOrders.isFetching ? 'evidence.workOrder.loading' : 'evidence.workOrder.placeholder')}
              emptyText={t('tracking.history.workOrderEmpty')} clearLabel={t('evidence.workOrder.clear')}
              disabled={!device || !canReadWorkOrders || cameraWorkOrders.isPending || problem !== null}
              aria-describedby={`${idPrefix}-work-order-hint`} />
          </Field>
          <p id={`${idPrefix}-work-order-hint`} className={canReadWorkOrders ? 'sr-only' : 'text-caption text-muted-foreground'}>
            {t(canReadWorkOrders ? 'tracking.history.workOrderHint' : 'evidence.workOrder.noPermission')}
          </p>
          {cameraWorkOrders.isError && problem === null ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-caption text-destructive">
              <p>{t('evidence.workOrder.loadFailed')}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void cameraWorkOrders.refetch()}>
                {t('evidence.workOrder.retry')}
              </Button>
            </div>
          ) : null}
          <Button
            type="button"
            className="min-h-11"
            disabled={!hasCamera || problem !== null}
            onClick={show}
          >
            {t('tracking.history.show')}
          </Button>
        </div>
        {problem && (draft.startDate || draft.endDate) ? (
          <p role="alert" className="text-sm text-destructive">
            {t(PROBLEM_KEY[problem], { hours: HISTORY_MAX_HOURS })}
          </p>
        ) : null}
        {pending ? <p className="text-sm font-medium text-warning-foreground">{t('tracking.history.notLoaded')}</p> : null}
        {query.deviceId && hasLoadedRange ? (
          <p className="text-sm text-muted-foreground">
            {t('tracking.history.loadedRange', { from: clockOf(query.from), to: clockOf(query.to) })}
          </p>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive" className="shrink-0">
          <TriangleAlert aria-hidden="true" />
          <div>
            <AlertTitle>{t('tracking.history.loadFailed')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
        </Alert>
      ) : null}
      {route?.truncated ? (
        <Alert className="shrink-0">
          <TriangleAlert aria-hidden="true" />
          <div>
            <AlertTitle>{t('tracking.history.truncatedTitle')}</AlertTitle>
            <AlertDescription>{t('tracking.history.truncatedBody')}</AlertDescription>
          </div>
        </Alert>
      ) : null}

        <div className="flex min-h-0 flex-1 flex-col gap-3 border-t border-border pt-4" aria-busy={history.isFetching}>
          {!query.deviceId ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {t('tracking.history.pickCamera')}
            </p>
          ) : !hasLoadedRange ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {t('tracking.history.pickRange')}
            </p>
          ) : history.isFetching && !route ? (
            <LoadingSkeleton loadingLabel={t('common.loading')} />
          ) : route && route.pointCount === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {t('tracking.history.empty')}
            </p>
          ) : route ? (
            <>
              <p className="shrink-0 text-sm">
                <span className="block font-medium">
                  {t('tracking.history.totalDistance', {
                    distance: distanceText(route.totalDistanceM, route.totalDistanceApprox, language),
                  })}
                </span>
                <span className="block">{t('tracking.history.summary', { stops })}</span>
              </p>
              <h2 className="shrink-0 text-sm font-semibold">{t('tracking.history.timeline')}</h2>
              <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain">
                {route.timeline.map((item) => {
                  const view = timelineView(item, language, withDate);
                  return (
                    <li key={view.key}>
                      <button
                        type="button"
                        onClick={() => { setFocus(view.focus); setMobilePanelOpen(false); }}
                        className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className={view.kind === 'gap' ? 'text-muted-foreground' : undefined}>
                          {t(view.labelKey, view.params)}
                        </span>
                        {view.distance ? (
                          <span className="block text-xs text-muted-foreground">{t(view.distance.key, view.distance.params)}</span>
                        ) : null}
                        {view.noSignal ? (
                          <span className="block text-xs text-muted-foreground">{t(view.noSignal.key, view.noSignal.params)}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
      <section aria-labelledby="tracking-history-title" className="relative isolate flex min-h-0 min-w-0 flex-1 overflow-hidden bg-muted">
        <h1 id="tracking-history-title" className="sr-only">{t('navigation.trackingHistory')}</h1>
        <aside className="hidden min-h-0 w-[26rem] shrink-0 flex-col overflow-hidden border-r border-border bg-card lg:flex">
          {renderPanel('history')}
        </aside>
        <div className="relative isolate min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="absolute inset-0 z-0">
            <MapCanvas zoomControlPosition="topright" className="tracking-live-map">
              {route && route.pointCount > 0 ? <RouteLayers route={route} focus={focus} /> : null}
            </MapCanvas>
          </div>
          <div className="absolute left-3 top-3 z-[500] lg:hidden">
            <DialogTrigger asChild>
              <Button type="button" variant="outline" className="bg-card shadow-sm"><ListFilter aria-hidden="true" />{t('tracking.history.openPanel')}</Button>
            </DialogTrigger>
          </div>
        </div>
      </section>
      <DialogContent closeLabel={t('tracking.history.closePanel')} className="flex h-dvh max-h-dvh flex-col gap-0 overflow-hidden p-0 lg:hidden [&_[data-slot=history-heading]]:min-h-10 [&_[data-slot=history-heading]]:pr-12">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('navigation.trackingHistory')}</DialogTitle>
          <DialogDescription className="sr-only">{t('tracking.history.description')}</DialogDescription>
        </DialogHeader>
        {renderPanel('history-mobile')}
      </DialogContent>
    </Dialog>
  );
}

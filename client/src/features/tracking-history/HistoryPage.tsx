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
import { Select } from '@/components/ui/select';
import type { TranslationKey } from '@/i18n/locales/th';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import { formatDayMonth, formatTime } from '@/lib/time';
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

/**
 * ประวัติเส้นทาง: one camera over a Bangkok start–end window of at most 36 h (a whole day by default).
 * The fields are a draft: only Show route or choosing a camera loads — every load is audited.
 */
/**
 * `viewSwitch`: shown as the history tab of แผนที่ติดตาม (with the ตำแหน่งปัจจุบัน | ประวัติเส้นทาง tabs).
 * The ประวัติเส้นทาง menu itself shows only the route history, with no tabs.
 */
export function HistoryPage({ viewSwitch = false }: { viewSwitch?: boolean } = {}) {
  const { t, language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseHistoryQuery(params), [params]);
  const hasCamera = Boolean(query.deviceId);
  const today = bangkokDateOf(new Date());
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [draft, setDraft] = useState<RangeFields>(() => rangeFieldsOf(query));
  // back / forward or a link changes the loaded window: the fields follow it
  useEffect(() => setDraft(rangeFieldsOf({ from: query.from, to: query.to })), [query.from, query.to]);

  const draftWindow = windowOfFields(draft);
  const problem = rangeProblem(draftWindow);
  const edit = (edge: 'start' | 'end') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const [date = '', time = ''] = e.target.value.split('T');
    const wallTime = time.split('.')[0];
    setDraft((current) => edge === 'start'
      ? { ...current, startDate: date, startTime: wallTime }
      : { ...current, endDate: date, endTime: wallTime });
  };

  const devices = useQuery({ queryKey: ['tracking', 'history-devices'], queryFn: historyApi.devices });
  const history = useQuery({
    queryKey: ['tracking', 'history', query.deviceId, query.from, query.to],
    queryFn: () => historyApi.history(query.deviceId!, query.from, query.to),
    enabled: hasCamera,
    // every request writes an audit row: never refetch on its own
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const go = (next: { deviceId?: string | null; window?: HistoryWindow }) => {
    setFocus(null);
    const window = next.window ?? { from: query.from, to: query.to };
    setDraft(rangeFieldsOf(window));
    const search = new URLSearchParams(historySearch({ deviceId: next.deviceId === undefined ? query.deviceId : next.deviceId, ...window }));
    // opened as a tab of แผนที่ติดตาม (`?view=history`): stay in that view
    const view = params.get(VIEW_PARAM);
    if (view) search.set(VIEW_PARAM, view);
    setParams(search);
  };

  // valid fields that differ from what is loaded: the results below are not for them yet
  const pending =
    problem === null && draftWindow !== null && (draftWindow.from !== query.from || draftWindow.to !== query.to);
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

  const route = history.data;
  const error = history.isError ? apiErrorOf(history.error, t).message : null;
  const stops = route?.timeline.filter((item) => item.kind === 'stop').length ?? 0;
  const withDate = spansDays(query);

  const renderPanel = (idPrefix: string) => (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-border p-3">
        <div data-slot="history-heading">
          <p aria-hidden="true" className="text-base font-semibold">{t('navigation.trackingHistory')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('tracking.history.description')}</p>
        </div>
        {viewSwitch ? <TrackingViewSwitch current="history" /> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-3">
      <div className="flex shrink-0 flex-col gap-3">
        <div>
          <label htmlFor={`${idPrefix}-camera`} className="mb-1 block text-sm font-medium">
            {t('tracking.history.camera')}
          </label>
          <Select
            id={`${idPrefix}-camera`}
            value={query.deviceId ?? ''}
            // the fields' range when valid (what the screen shows is what loads), else the loaded one
            onChange={(e) => go({ deviceId: e.target.value || null, window: problem ? undefined : draftWindow! })}
            disabled={devices.isPending}
          >
            <option value="">{t('tracking.history.cameraPlaceholder')}</option>
            {(devices.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name && d.name !== d.deviceCode ? `${d.deviceCode} · ${d.name}` : d.deviceCode}
              </option>
            ))}
          </Select>
        </div>
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
          <Button
            type="button"
            className="min-h-11"
            disabled={!hasCamera || problem !== null}
            onClick={show}
          >
            {t('tracking.history.show')}
          </Button>
        </div>
        {problem ? (
          <p role="alert" className="text-sm text-destructive">
            {t(PROBLEM_KEY[problem], { hours: HISTORY_MAX_HOURS })}
          </p>
        ) : null}
        {pending ? <p className="text-sm font-medium text-warning-foreground">{t('tracking.history.notLoaded')}</p> : null}
        {query.deviceId ? (
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
        <aside className="hidden min-h-0 w-80 shrink-0 flex-col overflow-hidden border-r border-border bg-card lg:flex">
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

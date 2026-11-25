import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/command-center';
import { MapCanvas } from '@/components/map/MapCanvas';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { TranslationKey } from '@/i18n/locales/th';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import { formatDayMonth, formatTime } from '@/lib/time';
import { RouteLayers } from './components/RouteLayers';
import { historyApi } from './history.api';
import {
  HISTORY_MAX_HOURS,
  bangkokDateOf,
  dayWindowOf,
  historySearch,
  isFutureDay,
  parseHistoryQuery,
  rangeFieldsOf,
  rangeProblem,
  shiftWindow,
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
 * The fields are a draft: only Show route (or whole day / previous / next / camera) loads — every load is audited.
 */
export function HistoryPage() {
  const { t, language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseHistoryQuery(params), [params]);
  const today = bangkokDateOf(new Date());
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const [draft, setDraft] = useState<RangeFields>(() => rangeFieldsOf(query));
  // back / forward or a link changes the loaded window: the fields follow it
  useEffect(() => setDraft(rangeFieldsOf({ from: query.from, to: query.to })), [query.from, query.to]);

  const draftWindow = windowOfFields(draft);
  const problem = rangeProblem(draftWindow);
  const prevWindow = shiftWindow(query, -1);
  const nextWindow = shiftWindow(query, 1);
  const wholeDayOk = /^\d{4}-\d{2}-\d{2}$/.test(draft.startDate) && !isFutureDay(draft.startDate);
  const edit = (field: keyof RangeFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((current) => ({ ...current, [field]: e.target.value }));

  const devices = useQuery({ queryKey: ['tracking', 'history-devices'], queryFn: historyApi.devices });
  const history = useQuery({
    queryKey: ['tracking', 'history', query.deviceId, query.from, query.to],
    queryFn: () => historyApi.history(query.deviceId!, query.from, query.to),
    enabled: Boolean(query.deviceId),
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
    setParams(historySearch({ deviceId: next.deviceId === undefined ? query.deviceId : next.deviceId, ...window }));
  };

  // valid fields that differ from what is loaded: the results below are not for them yet
  const pending =
    problem === null && draftWindow !== null && (draftWindow.from !== query.from || draftWindow.to !== query.to);
  const show = () => {
    if (!draftWindow) return;
    if (pending) return go({ window: draftWindow });
    // same range again = an explicit retry / refresh (e.g. today so far) — a user action, audited like any load
    setFocus(null);
    if (query.deviceId) void history.refetch();
  };
  const clockOf = (iso: string) => `${formatDayMonth(iso, language)} ${formatTime(iso, language)}`;

  const route = history.data;
  const error = history.isError ? apiErrorOf(history.error, t).message : null;
  const stops = route?.timeline.filter((item) => item.kind === 'stop').length ?? 0;
  const filtered = route ? route.suspectCount + route.staleStartCount + route.spikeCount : 0;
  const withDate = spansDays(query);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('navigation.trackingHistory')} description={t('tracking.history.description')} />

      <div className="mb-4 space-y-3">
        <div className="max-w-[18rem]">
          <label htmlFor="history-camera" className="mb-1 block text-sm font-medium">
            {t('tracking.history.camera')}
          </label>
          <Select
            id="history-camera"
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
        <div className="flex flex-wrap items-end gap-3">
          <div role="group" aria-labelledby="history-range-start">
            <span id="history-range-start" className="mb-1 block text-sm font-medium">
              {t('tracking.history.rangeStart')}
            </span>
            <div className="flex gap-2">
              <Input
                type="date"
                aria-label={t('tracking.history.startDate')}
                value={draft.startDate}
                max={today}
                onChange={edit('startDate')}
                className="min-h-11"
              />
              <Input
                type="time"
                aria-label={t('tracking.history.startTime')}
                value={draft.startTime}
                onChange={edit('startTime')}
                className="min-h-11 w-32"
              />
            </div>
          </div>
          <div role="group" aria-labelledby="history-range-end">
            <span id="history-range-end" className="mb-1 block text-sm font-medium">
              {t('tracking.history.rangeEnd')}
            </span>
            <div className="flex gap-2">
              <Input
                type="date"
                aria-label={t('tracking.history.endDate')}
                value={draft.endDate}
                onChange={edit('endDate')}
                className="min-h-11"
              />
              <Input
                type="time"
                aria-label={t('tracking.history.endTime')}
                value={draft.endTime}
                onChange={edit('endTime')}
                className="min-h-11 w-32"
              />
            </div>
          </div>
          <Button
            type="button"
            className="min-h-11"
            disabled={problem !== null}
            onClick={show}
          >
            {t('tracking.history.show')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!wholeDayOk}
            onClick={() => go({ window: dayWindowOf(draft.startDate) })}
          >
            {t('tracking.history.wholeDay')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 px-3"
            aria-label={t('tracking.history.prevDay')}
            onClick={() => go({ window: prevWindow })}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 px-3"
            aria-label={t('tracking.history.nextDay')}
            disabled={Date.parse(nextWindow.from) > Date.now()}
            onClick={() => go({ window: nextWindow })}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </Button>
        </div>
        {problem ? (
          <p role="alert" className="text-sm text-destructive">
            {t(PROBLEM_KEY[problem], { hours: HISTORY_MAX_HOURS })}
          </p>
        ) : null}
        {pending ? <p className="text-sm font-medium text-warning">{t('tracking.history.notLoaded')}</p> : null}
        {query.deviceId ? (
          <p className="text-sm text-muted-foreground">
            {t('tracking.history.loadedRange', { from: clockOf(query.from), to: clockOf(query.to) })}
          </p>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-3">
          <TriangleAlert aria-hidden="true" />
          <div>
            <AlertTitle>{t('tracking.history.loadFailed')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </div>
        </Alert>
      ) : null}
      {route?.truncated ? (
        <Alert className="mb-3">
          <TriangleAlert aria-hidden="true" />
          <div>
            <AlertTitle>{t('tracking.history.truncatedTitle')}</AlertTitle>
            <AlertDescription>{t('tracking.history.truncatedBody')}</AlertDescription>
          </div>
        </Alert>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="h-[60vh] min-h-[360px] overflow-hidden rounded-xl border border-border lg:h-auto">
          <MapCanvas>{route && route.pointCount > 0 ? <RouteLayers route={route} focus={focus} /> : null}</MapCanvas>
        </div>
        <aside className="flex min-h-0 flex-col gap-3" aria-busy={history.isFetching}>
          {!query.deviceId ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {t('tracking.history.pickCamera')}
            </p>
          ) : route && route.pointCount === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {t('tracking.history.empty')}
            </p>
          ) : route ? (
            <>
              <p className="text-sm">
                {t('tracking.history.summary', { points: route.pointCount, stops })}
                <span className="block font-medium">
                  {t('tracking.history.totalDistance', {
                    distance: distanceText(route.totalDistanceM, route.totalDistanceApprox, language),
                  })}
                </span>
                {route.totalDistanceApprox ? (
                  <span className="block text-xs text-muted-foreground">{t('tracking.history.totalDistanceApprox')}</span>
                ) : null}
                {filtered > 0 ? (
                  <span className="block text-xs text-muted-foreground">
                    {t('tracking.history.filtered', { count: filtered })}
                  </span>
                ) : null}
              </p>
              <h2 className="text-sm font-semibold">{t('tracking.history.timeline')}</h2>
              <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {route.timeline.map((item) => {
                  const view = timelineView(item, language, withDate);
                  return (
                    <li key={view.key}>
                      <button
                        type="button"
                        onClick={() => setFocus(view.focus)}
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
        </aside>
      </div>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/command-center';
import { MapCanvas } from '@/components/map/MapCanvas';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import { RouteLayers } from './components/RouteLayers';
import { historyApi } from './history.api';
import {
  bangkokDateOf,
  dayWindowOf,
  historySearch,
  isFutureDay,
  parseHistoryQuery,
  shiftDay,
} from './historyRange';
import { timelineView } from './historyTimeline';

/** ประวัติเส้นทาง: one camera, one Bangkok day (or a ≤ 24 h window from a link). Every load is audited. */
export function HistoryPage() {
  const { t, language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseHistoryQuery(params), [params]);
  const day = bangkokDateOf(new Date(query.from));
  const today = bangkokDateOf(new Date());
  const [focus, setFocus] = useState<[number, number] | null>(null);

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

  const go = (next: { deviceId?: string | null; day?: string }) => {
    setFocus(null);
    const window = next.day ? dayWindowOf(next.day) : { from: query.from, to: query.to };
    setParams(historySearch({ deviceId: next.deviceId === undefined ? query.deviceId : next.deviceId, ...window }));
  };

  const route = history.data;
  const error = history.isError ? apiErrorOf(history.error, t).message : null;
  const stops = route?.timeline.filter((item) => item.kind === 'stop').length ?? 0;
  const filtered = route ? route.suspectCount + route.staleStartCount + route.spikeCount : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('navigation.trackingHistory')} description={t('tracking.history.description')} />

      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,18rem)_auto] sm:items-end">
        <div>
          <label htmlFor="history-camera" className="mb-1 block text-sm font-medium">
            {t('tracking.history.camera')}
          </label>
          <Select
            id="history-camera"
            value={query.deviceId ?? ''}
            onChange={(e) => go({ deviceId: e.target.value || null })}
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
        <div className="flex items-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 px-3"
            aria-label={t('tracking.history.prevDay')}
            onClick={() => go({ day: shiftDay(day, -1) })}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Button>
          <div>
            <label htmlFor="history-date" className="mb-1 block text-sm font-medium">
              {t('tracking.history.date')}
            </label>
            <Input
              id="history-date"
              type="date"
              value={day}
              max={today}
              onChange={(e) => {
                if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && !isFutureDay(e.target.value)) go({ day: e.target.value });
              }}
              className="min-h-11"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 px-3"
            aria-label={t('tracking.history.nextDay')}
            disabled={isFutureDay(shiftDay(day, 1))}
            onClick={() => go({ day: shiftDay(day, 1) })}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </Button>
        </div>
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
                {filtered > 0 ? (
                  <span className="block text-xs text-muted-foreground">
                    {t('tracking.history.filtered', { count: filtered })}
                  </span>
                ) : null}
              </p>
              <h2 className="text-sm font-semibold">{t('tracking.history.timeline')}</h2>
              <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {route.timeline.map((item) => {
                  const view = timelineView(item, language);
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

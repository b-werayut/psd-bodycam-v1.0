import { useQuery } from '@tanstack/react-query';
import { Download, Play, TriangleAlert, VideoOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/command-center';
import { Can } from '@/components/Can';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { SearchSelect } from '@/components/ui/search-select';
import { Select } from '@/components/ui/select';
import { bangkokDateOf } from '@/features/tracking-history/historyRange';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import { formatDateTime, formatDayMonthYear } from '@/lib/time';
import { usePermission } from '@/lib/usePermission';
import { cn } from '@/lib/utils';
import { StreamPlayer } from '../streaming/components/StreamPlayer';
import { streamingApi, type RecordingFile } from '../streaming/streaming.api';
import { EvidenceDownloadStatus } from './components/EvidenceDownloadStatus';
import { RecordingSegmentsPanel, type SegmentsState } from './components/RecordingSegmentsPanel';
import {
  bangkokLocalInput,
  clipToDay,
  dayRange,
  fromBangkokLocalInput,
  formatDuration,
  selectableDays,
  validateEvidenceRange,
} from './evidenceRange';
import { loadCameraWorkOrders, workOrderDayRange } from './evidenceWorkOrders';
import { evidenceExportsApi } from './evidenceExports.api';
import { useEvidenceDownload } from './useEvidenceDownload';
import './evidence.css';

/** Playback changes only when the user confirms the selected range. */
type Playing = { startAt: string; endAt: string; nonce: number };

/** The current time, refreshed every 30 s so the day list follows midnight while the page stays open. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * วิดีโอย้อนหลัง: pick a camera + day, list that day's recorded files, play a file or an edited range.
 * Camera/day changes load recordings once. Failed loads can be retried; typing only filters local choices.
 */
export function EvidencePage() {
  const { t, language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const now = useNow();
  const today = bangkokDateOf(now);
  // keyed by the Bangkok day, so the list is rebuilt only when the day turns over
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const days = useMemo(() => selectableDays(now), [today]);
  const dateParam = params.get('date') ?? '';
  const date = days.includes(dateParam) ? dateParam : days[0]!;
  const deviceId = params.get('deviceId')?.trim() ?? '';

  const devices = useQuery({ queryKey: ['evidence', 'devices'], queryFn: streamingApi.devices });
  const device = devices.data?.find((d) => d.id === deviceId) ?? null;

  const recordings = useQuery({
    queryKey: ['evidence', 'recordings', deviceId, date],
    queryFn: () => streamingApi.recordings({ deviceId, ...dayRange(date) }),
    enabled: device !== null,
    // every search writes an audit row and calls the camera platform: never refetch on its own
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const canReadWorkOrders = usePermission('work-orders:read');
  const cameraWorkOrders = useQuery({
    queryKey: ['evidence', 'work-orders', deviceId],
    queryFn: () => loadCameraWorkOrders(deviceId),
    enabled: device !== null && canReadWorkOrders,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // the range and the playing clip belong to one camera + day: a change drops them (and unmounts the player)
  const context = `${deviceId}|${date}`;
  const [seen, setSeen] = useState(context);
  const [fromField, setFromField] = useState('');
  const [toField, setToField] = useState('');
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [workOrderId, setWorkOrderId] = useState('');
  if (seen !== context) {
    setSeen(context);
    setFromField('');
    setToField('');
    setPlaying(null);
    setActiveKey(null);
    setWorkOrderId('');
  }

  const day = dayRange(date, now);
  const availableWorkOrders = (cameraWorkOrders.data ?? []).filter((order) =>
    order.cameras.some((camera) => camera.deviceId === deviceId) && workOrderDayRange(order, day) !== null);
  const selectedWorkOrder = availableWorkOrders.find((order) => order.id === workOrderId);
  const workOrderRange = selectedWorkOrder ? workOrderDayRange(selectedWorkOrder, day) : null;
  const workOrderOptions = availableWorkOrders.map((order) => ({
    value: order.id,
    label: [order.workOrderNo, order.title].filter(Boolean).join(' · '),
  }));
  const chooseWorkOrder = (id: string) => {
    setWorkOrderId(id);
    setActiveKey(null);
    const order = availableWorkOrders.find((item) => item.id === id);
    const range = order ? workOrderDayRange(order, day) : null;
    setFromField(range ? bangkokLocalInput(range.startAt) : '');
    setToField(range ? bangkokLocalInput(range.endAt) : '');
  };

  const go = (next: { deviceId?: string; date?: string }) => {
    const search = new URLSearchParams();
    const id = next.deviceId ?? deviceId;
    if (id) search.set('deviceId', id);
    search.set('date', next.date ?? date);
    setParams(search);
  };

  const rangeError = validateEvidenceRange({ from: fromField, to: toField });
  const rangeProblem = fromField || toField ? rangeError : null;
  const canPlay = device !== null && rangeError === null;

  const selection = rangeError === null
    ? { startAt: fromBangkokLocalInput(fromField), endAt: fromBangkokLocalInput(toField) }
    : null;
  const selectFile = (file: RecordingFile) => {
    const clip = clipToDay(file, workOrderRange
      ? { from: workOrderRange.startAt, to: workOrderRange.endAt }
      : day);
    setFromField(bangkokLocalInput(clip.startAt));
    setToField(bangkokLocalInput(clip.endAt));
    setActiveKey(`${file.startAt}|${file.endAt}`);
  };
  // Replaying an unchanged range deliberately remounts a server-closed player.
  const playRange = () => {
    if (!canPlay || !selection) return;
    setPlaying((current) => ({ ...selection, nonce: (current?.nonce ?? 0) + 1 }));
  };

  const canExport = usePermission('evidence:export');
  const exportPolicy = useQuery({
    queryKey: ['evidence', 'export-policy'],
    queryFn: evidenceExportsApi.policy,
    enabled: canExport,
    staleTime: 5 * 60_000,
  });
  const maxMinutes = exportPolicy.data?.maxMinutes ?? null;
  const rangeMinutes =
    rangeError === null
      ? (Date.parse(fromBangkokLocalInput(toField)) - Date.parse(fromBangkokLocalInput(fromField))) / 60_000
      : null;
  const overCap = maxMinutes !== null && rangeMinutes !== null && rangeMinutes > maxMinutes;
  const download = useEvidenceDownload();
  const resetDownload = download.reset;
  // a different camera, day or range is a different export: drop the status (the server job keeps running)
  useEffect(() => {
    resetDownload();
  }, [context, fromField, toField, resetDownload]);
  const requestExport = () => {
    if (!device || !canPlay || overCap) return;
    download.request({
      deviceCode: device.deviceCode,
      startAt: fromBangkokLocalInput(fromField),
      endAt: fromBangkokLocalInput(toField),
    });
  };
  const exportBlocked = !canPlay || overCap;

  const retryRecordings = () => {
    if (device) void recordings.refetch();
  };

  const segments: SegmentsState = !device
    ? { kind: 'idle' }
    : recordings.isFetching
      ? { kind: 'loading' }
      : recordings.isError
        ? { kind: 'error', message: apiErrorOf(recordings.error, t).message }
        : recordings.data
          ? { kind: 'ready', files: recordings.data.data }
          : { kind: 'idle' };

  const cameraOptions = (devices.data ?? []).map((d) => ({
    value: d.id,
    label: d.name && d.name !== d.deviceCode ? `${d.deviceCode} · ${d.name}` : d.deviceCode,
  }));
  const dayLabel = (ymd: string, index: number) => {
    const label = formatDayMonthYear(new Date(`${ymd}T12:00:00+07:00`), language);
    return index === 0 ? `${t('evidence.today')} · ${label}` : label;
  };

  const noRecordings = segments.kind === 'ready' && segments.files.length === 0;
  const selectedFile = segments.kind === 'ready'
    ? segments.files.find((file) => `${file.startAt}|${file.endAt}` === activeKey)
    : undefined;
  const visibleSegments: SegmentsState = segments.kind === 'ready' && workOrderRange
    ? { ...segments, files: segments.files.filter((file) =>
        Date.parse(file.startAt) < Date.parse(workOrderRange.endAt)
        && Date.parse(file.endAt) > Date.parse(workOrderRange.startAt)) }
    : segments;
  const selectionLabel = selection
    ? bangkokDateOf(new Date(selection.startAt)) === bangkokDateOf(new Date(selection.endAt))
      ? `${bangkokLocalInput(selection.startAt).slice(11)} – ${bangkokLocalInput(selection.endAt).slice(11)}`
      : `${formatDateTime(selection.startAt, language, { seconds: true })} – ${formatDateTime(selection.endAt, language, { seconds: true })}`
    : '—';

  return (
    <div className="evidence-page mx-auto flex w-full flex-col gap-6">
      <PageHeader title={t('evidence.title')} description={t('evidence.description')} className="mb-0 [&_p]:max-w-none" />

      <div className="evidence-workspace grid gap-4 lg:grid-cols-[minmax(0,1.85fr)_minmax(320px,1fr)]">
        <div className="evidence-player min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          {device && playing ? (
            <StreamPlayer key={`${device.deviceCode}|${playing.startAt}|${playing.endAt}|${playing.nonce}`}
              device={{ deviceCode: device.deviceCode, deviceName: device.name }}
              playback={{ startAt: playing.startAt, endAt: playing.endAt }} errorFeedback="toast" />
          ) : (
            <Empty role="status" aria-label={t('evidence.player.stage')} className="stream-stage aspect-video w-full gap-0 rounded-none">
              <EmptyHeader className="max-w-lg">
                <EmptyMedia>
                  {!selection
                    ? <VideoOff aria-hidden="true" size={44} strokeWidth={1.5} className="stream-stage__icon" />
                    : <Play aria-hidden="true" size={44} strokeWidth={1.5} className="stream-stage__icon" />}
                </EmptyMedia>
                <EmptyTitle className="stream-stage__title text-control font-medium">
                  {t(selection ? 'evidence.player.idleTitle' : 'evidence.player.empty')}
                </EmptyTitle>
                <EmptyDescription className="stream-stage__hint text-caption">
                  {t(selection ? 'evidence.player.selectionReady' : noRecordings ? 'evidence.player.emptyHint' : device ? 'evidence.player.chooseFile' : 'evidence.player.chooseCamera')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>

        <aside aria-label={t('evidence.controls.title')} className="evidence-inspector flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="evidence-inspector-section evidence-search">
            <FieldGroup className="gap-2">
              <div className="evidence-search-camera-date grid gap-3">
                <Field className="min-w-0">
                  <FieldLabel htmlFor="evidence-camera">{t('evidence.camera')}</FieldLabel>
                  <SearchSelect id="evidence-camera" value={device?.id ?? ''} onChange={(value) => go({ deviceId: value })}
                    options={cameraOptions} placeholder={t('evidence.cameraPlaceholder')} emptyText={t('evidence.cameraNone')}
                    clearLabel={t('common.pickerClear')} disabled={devices.isPending} />
                </Field>
                <Field className="min-w-0">
                  <FieldLabel htmlFor="evidence-day">{t('evidence.day')}</FieldLabel>
                  <Select id="evidence-day" value={date} onChange={(e) => go({ date: e.target.value })}>
                    {days.map((ymd, index) => <option key={ymd} value={ymd}>{dayLabel(ymd, index)}</option>)}
                  </Select>
                </Field>
              </div>
              <Field className="min-w-0">
                <FieldLabel htmlFor="evidence-work-order">{t('evidence.workOrder.label')}</FieldLabel>
                <SearchSelect id="evidence-work-order" value={workOrderId} onChange={chooseWorkOrder}
                  options={workOrderOptions} wrapOptions
                  placeholder={t(!device ? 'evidence.workOrder.pickCamera' : cameraWorkOrders.isFetching ? 'evidence.workOrder.loading' : 'evidence.workOrder.placeholder')}
                  emptyText={t('evidence.workOrder.empty')} clearLabel={t('evidence.workOrder.clear')}
                  disabled={!device || !canReadWorkOrders || cameraWorkOrders.isPending}
                  aria-describedby="evidence-work-order-hint" />
              </Field>
            </FieldGroup>
            <p id="evidence-work-order-hint" className={canReadWorkOrders ? 'sr-only' : 'mt-2 text-caption text-muted-foreground'}>
              {t(canReadWorkOrders ? 'evidence.workOrder.hint' : 'evidence.workOrder.noPermission')}
            </p>
            {cameraWorkOrders.isError ? (
              <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-caption text-destructive">
                <p>{t('evidence.workOrder.loadFailed')}</p>
                <Button type="button" size="sm" variant="outline" onClick={() => void cameraWorkOrders.refetch()}>
                  {t('evidence.workOrder.retry')}
                </Button>
              </div>
            ) : null}
            {devices.isError ? (
              <Alert variant="destructive" feedbackScope="operational" className="mt-3">
                <TriangleAlert aria-hidden="true" />
                <AlertDescription>{apiErrorOf(devices.error, t).message}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <Separator />
          <section aria-labelledby="evidence-selection-title" className="evidence-inspector-section">
            <h2 id="evidence-selection-title" className="text-control font-semibold">{t('evidence.selection.title')}</h2>
            <dl aria-live="polite" className="mt-2 flex flex-col gap-1 text-control">
              <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">{t('evidence.selection.range')}</dt>
                <dd className="font-medium tabular-nums">{selectionLabel}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{t('evidence.selection.duration')}</dt>
                <dd className="font-medium tabular-nums">{selection ? formatDuration((Date.parse(selection.endAt) - Date.parse(selection.startAt)) / 1000) : '—'}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">{t('evidence.selection.workOrder')}</dt>
                <dd className="min-w-0 break-all font-medium">{selectedWorkOrder?.workOrderNo ?? (selectedFile ? selectedFile.workOrder?.workOrderNo ?? t('evidence.unlinked') : '—')}</dd>
              </div>
            </dl>
          </section>
          <Separator />
          <section aria-labelledby="evidence-range-title">
            <div className="evidence-inspector-section">
              <h3 id="evidence-range-title" className="text-control font-semibold">{t('evidence.range.title')}</h3>
              <FieldGroup className="mt-2 gap-2">
                <Field orientation="horizontal" data-disabled={!device} data-invalid={!!rangeProblem} className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)]">
                  <FieldLabel htmlFor="evidence-from">{t('evidence.range.from')}</FieldLabel>
                  <Input id="evidence-from" type="datetime-local" step={1} max={`${today}T23:59:59`} value={fromField}
                    disabled={!device} onChange={(e) => { setFromField(e.target.value); setActiveKey(null); }} className="min-w-0 max-w-full"
                    aria-invalid={!!rangeProblem} aria-describedby={rangeProblem ? 'evidence-range-error' : undefined} />
                </Field>
                <Field orientation="horizontal" data-disabled={!device} data-invalid={!!rangeProblem} className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)]">
                  <FieldLabel htmlFor="evidence-to">{t('evidence.range.to')}</FieldLabel>
                  <Input id="evidence-to" type="datetime-local" step={1} value={toField} disabled={!device}
                    onChange={(e) => { setToField(e.target.value); setActiveKey(null); }} className="min-w-0 max-w-full"
                    aria-invalid={!!rangeProblem} aria-describedby={rangeProblem ? 'evidence-range-error' : undefined} />
                </Field>
              </FieldGroup>
            </div>
            <Separator />
            <div className="evidence-inspector-section bg-muted/25">
              <div className={cn('grid gap-2', canExport && 'grid-cols-2')}>
                <Button type="button" className="min-h-11 w-full" onClick={playRange} disabled={!canPlay}>
                  <Play aria-hidden="true" className="size-4" />{t('evidence.play')}
                </Button>
                <Can permission="evidence:export">
                  <Button type="button" variant="outline" className="min-h-11 w-full" onClick={requestExport} disabled={exportBlocked || download.requesting}>
                    <Download aria-hidden="true" className="size-4" />{t('evidence.download.button')}
                  </Button>
                </Can>
              </div>
              <Can permission="evidence:export">
                <EvidenceDownloadStatus download={download} blocked={exportBlocked} onRequest={requestExport} />
              </Can>
              <p className="evidence-limits mt-2 flex flex-wrap gap-x-1 text-caption text-muted-foreground">
                <span className="whitespace-nowrap">{t('evidence.range.description')}</span>
                <Can permission="evidence:export">
                  {maxMinutes !== null ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="whitespace-nowrap">{t('evidence.download.cap', { n: maxMinutes })}</span>
                    </>
                  ) : null}
                </Can>
              </p>
              {rangeProblem ? (
                <p id="evidence-range-error" role="alert" className="mt-2 text-caption text-destructive">{t(rangeProblem)}</p>
              ) : null}
            </div>
          </section>
        </aside>
      </div>

      <RecordingSegmentsPanel state={visibleSegments} date={date} activeKey={activeKey} filtered={workOrderRange !== null} onSelect={selectFile} onRetry={retryRecordings} />
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Download, Play, Search, TriangleAlert, VideoOff } from 'lucide-react';
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
import { formatFileSize } from './evidenceDownload';
import { evidenceExportsApi } from './evidenceExports.api';
import { useEvidenceDownload } from './useEvidenceDownload';
import './evidence.css';

/** `fileKey` = the clicked recording file's own `startAt|endAt` (unclipped), null for a hand-typed range. */
type Playing = { startAt: string; endAt: string; nonce: number; fileKey: string | null };

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
 * Every search goes to the camera platform and is audited, so it runs only on the search button or a camera / day
 * change — never while typing.
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

  // the range and the playing clip belong to one camera + day: a change drops them (and unmounts the player)
  const context = `${deviceId}|${date}`;
  const [seen, setSeen] = useState(context);
  const [fromField, setFromField] = useState('');
  const [toField, setToField] = useState('');
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [fileFilter, setFileFilter] = useState('');
  if (seen !== context) {
    setSeen(context);
    setFromField('');
    setToField('');
    setPlaying(null);
    setFileFilter('');
  }

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

  const play = (startAt: string, endAt: string, fileKey: string | null) =>
    setPlaying((current) => ({ startAt, endAt, fileKey, nonce: (current?.nonce ?? 0) + 1 }));
  const playFile = (file: RecordingFile) => {
    const clip = clipToDay(file, dayRange(date));
    setFromField(bangkokLocalInput(clip.startAt));
    setToField(bangkokLocalInput(clip.endAt));
    play(clip.startAt, clip.endAt, `${file.startAt}|${file.endAt}`);
  };
  // a press with an unchanged range plays it again (the player remounts), e.g. after the server closed an idle one
  const playRange = () => {
    if (!canPlay) return;
    const startAt = fromBangkokLocalInput(fromField);
    const endAt = fromBangkokLocalInput(toField);
    // an unchanged range replays the same file, so it stays highlighted
    const sameClip = playing?.startAt === startAt && playing.endAt === endAt;
    play(startAt, endAt, sameClip ? playing.fileKey : null);
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
  const fileSize = formatFileSize(download.view?.fileSizeBytes ?? null);

  const search = () => {
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
  const activeKey = playing?.fileKey ?? null;

  const noRecordings = segments.kind === 'ready' && segments.files.length === 0;
  const selectedFile = segments.kind === 'ready'
    ? segments.files.find((file) => `${file.startAt}|${file.endAt}` === activeKey)
    : undefined;
  const filter = fileFilter.trim().toLocaleLowerCase();
  const visibleSegments: SegmentsState = segments.kind === 'ready' && filter
    ? { ...segments, files: segments.files.filter((file) =>
        [bangkokLocalInput(file.startAt).slice(11), bangkokLocalInput(file.endAt).slice(11), file.workOrder?.workOrderNo ?? t('evidence.unlinked')]
          .some((value) => value.toLocaleLowerCase().includes(filter))) }
    : segments;
  const playingLabel = playing
    ? bangkokDateOf(new Date(playing.startAt)) === bangkokDateOf(new Date(playing.endAt))
      ? `${bangkokLocalInput(playing.startAt).slice(11)} – ${bangkokLocalInput(playing.endAt).slice(11)}`
      : `${formatDateTime(playing.startAt, language, { seconds: true })} – ${formatDateTime(playing.endAt, language, { seconds: true })}`
    : '—';

  return (
    <div className="evidence-page mx-auto flex w-full flex-col gap-4">
      <PageHeader title={t('evidence.title')} description={t('evidence.description')} className="mb-0 [&_p]:max-w-none" />

      <FieldGroup className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1.2fr)_minmax(180px,0.75fr)_minmax(200px,1fr)_auto]">
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
        <Field className="min-w-0">
          <FieldLabel htmlFor="evidence-file-filter">{t('evidence.filter.label')}</FieldLabel>
          <Input id="evidence-file-filter" type="search" value={fileFilter} onChange={(e) => setFileFilter(e.target.value)}
            placeholder={t('evidence.filter.placeholder')} disabled={segments.kind !== 'ready' || segments.files.length === 0} />
        </Field>
        <Button type="button" className="min-h-11" onClick={search} disabled={!device || recordings.isFetching}
          title={device ? undefined : t('evidence.selectCameraFirst')}>
          <Search aria-hidden="true" className="size-4" />
          {recordings.isFetching ? t('evidence.searching') : t('evidence.search')}
        </Button>
      </FieldGroup>

      {devices.isError ? (
        <Alert variant="destructive" feedbackScope="operational">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>{apiErrorOf(devices.error, t).message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="evidence-workspace grid gap-4 lg:grid-cols-[minmax(0,1.85fr)_minmax(320px,1fr)]">
        <div className="evidence-player min-w-0 overflow-hidden rounded-lg border border-border bg-card">
          {device && playing ? (
            <StreamPlayer key={`${device.deviceCode}|${playing.startAt}|${playing.endAt}|${playing.nonce}`}
              device={{ deviceCode: device.deviceCode, deviceName: device.name }}
              playback={{ startAt: playing.startAt, endAt: playing.endAt }} />
          ) : (
            <Empty role="status" aria-label={t('evidence.player.stage')} className="stream-stage aspect-video w-full gap-0 rounded-none">
              <EmptyHeader className="max-w-lg">
                <EmptyMedia>
                  {noRecordings
                    ? <VideoOff aria-hidden="true" size={44} strokeWidth={1.5} className="stream-stage__icon" />
                    : <Play aria-hidden="true" size={44} strokeWidth={1.5} className="stream-stage__icon" />}
                </EmptyMedia>
                <EmptyTitle className="stream-stage__title text-control font-medium">
                  {t(noRecordings ? 'evidence.player.empty' : 'evidence.player.idleTitle')}
                </EmptyTitle>
                <EmptyDescription className="stream-stage__hint text-caption">
                  {t(noRecordings ? 'evidence.player.emptyHint' : device ? 'evidence.player.chooseFile' : 'evidence.player.chooseCamera')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>

        <section aria-labelledby="evidence-selection-title" className="evidence-inspector flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <h2 id="evidence-selection-title" className="text-control font-semibold">{t('evidence.selection.title')}</h2>
          <dl aria-live="polite" className="flex flex-col gap-2 text-control">
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">{t('evidence.selection.range')}</dt>
              <dd className="font-medium tabular-nums">{playingLabel}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t('evidence.selection.duration')}</dt>
              <dd className="font-medium tabular-nums">{playing ? formatDuration((Date.parse(playing.endAt) - Date.parse(playing.startAt)) / 1000) : '—'}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">{t('evidence.selection.workOrder')}</dt>
              <dd className="min-w-0 break-all font-medium">{selectedFile ? selectedFile.workOrder?.workOrderNo ?? t('evidence.unlinked') : '—'}</dd>
            </div>
          </dl>
          <Separator />
          <div>
            <h3 id="evidence-range-title" className="text-control font-semibold">{t('evidence.range.title')}</h3>
            <FieldGroup className="mt-3 gap-3">
              <Field orientation="horizontal" data-disabled={!device} data-invalid={!!rangeProblem} className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)]">
                <FieldLabel htmlFor="evidence-from">{t('evidence.range.from')}</FieldLabel>
                <Input id="evidence-from" type="datetime-local" step={1} max={`${today}T23:59:59`} value={fromField}
                  disabled={!device} onChange={(e) => setFromField(e.target.value)} className="min-w-0 max-w-full"
                  aria-invalid={!!rangeProblem} aria-describedby={rangeProblem ? 'evidence-range-error' : undefined} />
              </Field>
              <Field orientation="horizontal" data-disabled={!device} data-invalid={!!rangeProblem} className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)]">
                <FieldLabel htmlFor="evidence-to">{t('evidence.range.to')}</FieldLabel>
                <Input id="evidence-to" type="datetime-local" step={1} value={toField} disabled={!device}
                  onChange={(e) => setToField(e.target.value)} className="min-w-0 max-w-full"
                  aria-invalid={!!rangeProblem} aria-describedby={rangeProblem ? 'evidence-range-error' : undefined} />
              </Field>
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
            </FieldGroup>
            <p className="mt-3 text-caption leading-relaxed text-muted-foreground">{t('evidence.range.description')}</p>
            <Can permission="evidence:export">
              {maxMinutes !== null ? (
                <p className="mt-2 text-caption text-muted-foreground">
                  {t('evidence.download.cap', { n: maxMinutes })}
                </p>
              ) : null}
              {download.requesting || download.state !== 'idle' ? (
                <div className="mt-2 rounded-md border border-border bg-muted/40 p-3 text-sm" aria-live="polite">
                  {download.requesting ? <p>{t('evidence.download.requesting')}</p> : null}
                  {download.state === 'queued' ? <p>{t('evidence.download.queued')}</p> : null}
                  {download.state === 'processing' ? (
                    <div className="flex flex-col gap-2">
                      <p>{t('evidence.download.processing', { n: download.progress })}</p>
                      <div
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={download.progress}
                        className="h-2 overflow-hidden rounded-full bg-border"
                      >
                        <div className="h-full bg-primary" style={{ width: `${download.progress}%` }} />
                      </div>
                    </div>
                  ) : null}
                  {download.state === 'ready' ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="font-medium">{t('evidence.download.ready')}</p>
                      <Can
                        permission="evidence:download"
                        fallback={<p className="text-muted-foreground">{t('evidence.download.noPermission')}</p>}
                      >
                        <Button type="button" size="sm" onClick={download.download} disabled={download.downloading}>
                          <Download aria-hidden="true" className="size-4" />
                          {t('evidence.download.file', { name: download.view?.fileName ?? 'MP4' })}
                          {fileSize ? ` (${fileSize})` : ''}
                        </Button>
                      </Can>
                    </div>
                  ) : null}
                  {download.state === 'failed' ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="font-medium text-destructive">{t('evidence.download.failed')}</p>
                      {download.error ? <p>{download.error}</p> : null}
                      <Button type="button" size="sm" variant="outline" onClick={requestExport} disabled={exportBlocked}>
                        {t('evidence.download.retry')}
                      </Button>
                    </div>
                  ) : null}
                  {download.state === 'expired' ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="font-medium">{t('evidence.download.expired')}</p>
                      <Button type="button" size="sm" variant="outline" onClick={requestExport} disabled={exportBlocked}>
                        {t('evidence.download.again')}
                      </Button>
                    </div>
                  ) : null}
                  {download.state === 'ready' && download.error ? (
                    <p role="alert" className="mt-2 text-destructive">
                      {download.error}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </Can>
            {rangeProblem ? (
              <p id="evidence-range-error" role="alert" className="mt-2 text-caption text-destructive">{t(rangeProblem)}</p>
            ) : playing ? <p className="mt-2 text-caption text-muted-foreground">{t('evidence.player.replay')}</p> : null}
          </div>
        </section>
      </div>

      <RecordingSegmentsPanel state={visibleSegments} date={date} activeKey={activeKey} filtered={!!filter} onPlay={playFile} onRetry={search} />
    </div>
  );
}

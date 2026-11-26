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
import { EvidenceDownloadStatus } from './components/EvidenceDownloadStatus';
import { RecordingFileList } from './components/RecordingFileList';
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
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [fileFilter, setFileFilter] = useState('');
  if (seen !== context) {
    setSeen(context);
    setFromField('');
    setToField('');
    setPlaying(null);
    setActiveKey(null);
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

  const selection = rangeError === null
    ? { startAt: fromBangkokLocalInput(fromField), endAt: fromBangkokLocalInput(toField) }
    : null;
  const selectFile = (file: RecordingFile) => {
    const clip = clipToDay(file, dayRange(date));
    setFromField(bangkokLocalInput(clip.startAt));
    setToField(bangkokLocalInput(clip.endAt));
    setActiveKey(`${file.startAt}|${file.endAt}`);
  };
  // Replaying an unchanged range deliberately remounts a server-closed player.
  const playRange = () => {
    if (!canPlay || !selection) return;
    setPlaying((current) => ({ ...selection, nonce: (current?.nonce ?? 0) + 1 }));
  };
  const isPlayingSelection = playing !== null && selection !== null
    && playing.startAt === selection.startAt && playing.endAt === selection.endAt;

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
  const selectionLabel = selection
    ? bangkokDateOf(new Date(selection.startAt)) === bangkokDateOf(new Date(selection.endAt))
      ? `${bangkokLocalInput(selection.startAt).slice(11)} – ${bangkokLocalInput(selection.endAt).slice(11)}`
      : `${formatDateTime(selection.startAt, language, { seconds: true })} – ${formatDateTime(selection.endAt, language, { seconds: true })}`
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

        <section aria-labelledby="evidence-selection-title" className="evidence-inspector flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
          <div className="evidence-inspector-section">
            <h2 id="evidence-selection-title" className="text-control font-semibold">{t('evidence.selection.title')}</h2>
            <dl aria-live="polite" className="mt-3 flex flex-col gap-2 text-control">
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
                <dd className="min-w-0 break-all font-medium">{selectedFile ? selectedFile.workOrder?.workOrderNo ?? t('evidence.unlinked') : '—'}</dd>
              </div>
            </dl>
          </div>
          <Separator />
          <section aria-labelledby="evidence-range-title">
            <div className="evidence-inspector-section">
              <h3 id="evidence-range-title" className="text-control font-semibold">{t('evidence.range.title')}</h3>
              <FieldGroup className="mt-3 gap-3">
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
            <div className="evidence-inspector-section">
              <RecordingFileList state={visibleSegments} activeKey={activeKey} filtered={!!filter} onSelect={selectFile} onRetry={search} />
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
              <p className="mt-3 text-caption leading-relaxed text-muted-foreground">{t('evidence.range.description')}</p>
              <Can permission="evidence:export">
                {maxMinutes !== null ? (
                  <p className="mt-2 text-caption text-muted-foreground">
                    {t('evidence.download.cap', { n: maxMinutes })}
                  </p>
                ) : null}
              </Can>
              {rangeProblem ? (
                <p id="evidence-range-error" role="alert" className="mt-2 text-caption text-destructive">{t(rangeProblem)}</p>
              ) : selection ? (
                <p className="mt-2 text-caption text-muted-foreground">
                  {t(isPlayingSelection ? 'evidence.player.replay' : 'evidence.player.selectionReady')}
                </p>
              ) : null}
            </div>
          </section>
        </section>
      </div>

      <RecordingSegmentsPanel state={visibleSegments} date={date} activeKey={activeKey} onSelect={selectFile} />
    </div>
  );
}

import { Play, TriangleAlert, VideoOff } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { bangkokDateOf } from '@/features/tracking-history/historyRange';
import { useLanguage } from '@/i18n/useLanguage';
import { formatDayMonth, formatTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { RecordingFile } from '../../streaming/streaming.api';
import { formatDuration, recordingDayPosition } from '../evidenceRange';

export type SegmentsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; files: RecordingFile[] };

const HOURS = Array.from({ length: 25 }, (_, hour) => hour);

/** The ruler and file buttons select the same recording, including midnight-crossing files. */
export function RecordingSegmentsPanel({ state, date, activeKey, filtered = false, onPlay, onRetry }: {
  state: SegmentsState;
  date: string;
  /** The original file's start/end, before clipping to the selected day. */
  activeKey: string | null;
  filtered?: boolean;
  onPlay: (file: RecordingFile) => void;
  onRetry: () => void;
}) {
  const { t, language } = useLanguage();
  const files = state.kind === 'ready' ? state.files : [];
  const clock = (file: RecordingFile) => {
    const crosses = bangkokDateOf(new Date(file.startAt)) !== bangkokDateOf(new Date(file.endAt));
    const point = (iso: string) =>
      crosses ? `${formatDayMonth(iso, language)} ${formatTime(iso, language)}` : formatTime(iso, language);
    return `${point(file.startAt)}–${point(file.endAt)}`;
  };
  const selected = files.find((file) => `${file.startAt}|${file.endAt}` === activeKey);
  const position = selected ? recordingDayPosition(selected, date) : null;

  return (
    <section aria-label={t('evidence.segments.title')} className="evidence-recordings flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-title font-semibold">{t('evidence.timeline.title')}</h2>
          <p className="evidence-timeline-description mt-1 text-caption text-muted-foreground">{t('evidence.timeline.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-caption text-muted-foreground">
          {state.kind === 'ready' ? <span>{t('evidence.segments.count', { count: files.length })}</span> : null}
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="size-3 rounded-sm bg-primary" />
            {t('evidence.timeline.available')}
          </span>
        </div>
      </header>
      <div className="mx-4 min-w-0">
        <div className="evidence-timeline-selection relative h-6" aria-hidden="true">
          {selected && position ? (
            <span className="absolute bottom-0 max-w-full -translate-x-1/2 truncate rounded-md bg-primary px-2 py-1 text-caption font-medium tabular-nums text-primary-foreground"
              style={{ left: `${Math.max(15, Math.min(85, position.left + position.width / 2))}%` }}>
              {clock(selected)} · {formatDuration(selected.durationSeconds)}
            </span>
          ) : null}
        </div>
        <div className="relative h-8" aria-hidden="true">
          {HOURS.map((hour) => (
            <div key={hour} className="absolute inset-y-0" style={{ left: `${(hour / 24) * 100}%` }}>
              {hour % 3 === 0 ? (
                <span className={cn('absolute top-1 -translate-x-1/2 text-caption tabular-nums text-muted-foreground', hour % 6 !== 0 && 'hidden sm:block')}>
                  {String(hour).padStart(2, '0')}:00
                </span>
              ) : null}
              <span className={cn('absolute bottom-0 border-l border-border', hour % 3 === 0 ? 'h-3' : 'h-1.5')} />
            </div>
          ))}
        </div>
        <div role="group" aria-label={t('evidence.timeline.label')} className="relative h-8">
          <div aria-hidden="true" className="absolute inset-x-0 top-2 h-3 rounded-sm bg-muted" />
          {files.map((file) => {
            const key = `${file.startAt}|${file.endAt}`;
            const bar = recordingDayPosition(file, date);
            if (!bar) return null;
            return (
              <button key={key} type="button" aria-label={t('evidence.timeline.open', { range: clock(file) })}
                aria-pressed={activeKey === key} title={`${clock(file)} · ${formatDuration(file.durationSeconds)}`}
                onClick={() => onPlay(file)} style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                className="group absolute inset-y-0 min-w-[2px] rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <span aria-hidden="true" className={cn('absolute inset-x-0 top-2 h-3 rounded-sm bg-primary/45 transition-colors group-hover:bg-primary motion-reduce:transition-none', activeKey === key && 'bg-primary')} />
              </button>
            );
          })}
        </div>
      </div>
      {state.kind === 'idle' ? (
        <p className="py-3 text-center text-caption text-muted-foreground">{t('evidence.segments.idle')}</p>
      ) : state.kind === 'loading' ? (
        <p role="status" className="py-3 text-center text-caption text-muted-foreground">{t('evidence.searching')}</p>
      ) : state.kind === 'error' ? (
        <Alert variant="destructive" feedbackScope="operational">
          <TriangleAlert aria-hidden="true" />
          <div>
            <p className="font-medium">{t('evidence.error.search')}</p>
            <AlertDescription>{state.message}</AlertDescription>
            <Button type="button" variant="outline" size="sm" className="mt-3 min-h-11" onClick={onRetry}>{t('evidence.error.retry')}</Button>
          </div>
        </Alert>
      ) : files.length === 0 ? (
        <Empty className="gap-2 p-3 md:p-3">
          <EmptyHeader>
            <EmptyMedia><VideoOff aria-hidden="true" className="size-6 text-muted-foreground" /></EmptyMedia>
            <EmptyDescription>{t(filtered ? 'evidence.segments.noMatches' : 'evidence.segments.empty')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul aria-label={t('evidence.segments.title')} className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 overflow-y-auto p-0.5">
          {files.map((file) => {
            const key = `${file.startAt}|${file.endAt}`;
            return (
              <li key={key} className="min-w-0">
                <button type="button" aria-pressed={activeKey === key} onClick={() => onPlay(file)}
                  className={cn('flex min-h-16 w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2.5 text-center transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none', activeKey === key && 'border-primary bg-accent text-primary')}>
                  <Play aria-hidden="true" className="size-4 shrink-0" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-control font-medium tabular-nums">{clock(file)}</span>
                    <span className="flex flex-wrap justify-center gap-x-2 text-caption text-muted-foreground">
                      <span>{t('evidence.segments.duration', { duration: formatDuration(file.durationSeconds) })}</span>
                      <span className="break-all">{file.workOrder?.workOrderNo ?? t('evidence.unlinked')}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

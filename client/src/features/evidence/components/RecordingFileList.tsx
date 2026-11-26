import { Play, TriangleAlert, VideoOff } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { useLanguage } from '@/i18n/useLanguage';
import { cn } from '@/lib/utils';
import type { RecordingFile } from '../../streaming/streaming.api';
import { formatDuration } from '../evidenceRange';
import { recordingClock } from '../recordingPresentation';
import type { SegmentsState } from './RecordingSegmentsPanel';

export function RecordingFileList({ state, activeKey, filtered, onPlay, onRetry }: {
  state: SegmentsState;
  activeKey: string | null;
  filtered: boolean;
  onPlay: (file: RecordingFile) => void;
  onRetry: () => void;
}) {
  const { t, language } = useLanguage();
  const files = state.kind === 'ready' ? state.files : [];

  return (
    <section aria-labelledby="evidence-files-title" className="flex min-w-0 flex-col gap-2">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 id="evidence-files-title" className="text-control font-semibold">{t('evidence.segments.title')}</h3>
        {state.kind === 'ready' ? (
          <span className="text-caption text-muted-foreground">{t('evidence.segments.count', { count: files.length })}</span>
        ) : null}
      </header>
      {state.kind === 'idle' ? (
        <p className="py-2 text-caption text-muted-foreground">{t('evidence.segments.idle')}</p>
      ) : state.kind === 'loading' ? (
        <p role="status" className="py-2 text-caption text-muted-foreground">{t('evidence.searching')}</p>
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
        <Empty className="gap-2 p-2 md:p-2">
          <EmptyHeader>
            <EmptyMedia><VideoOff aria-hidden="true" className="size-5 text-muted-foreground" /></EmptyMedia>
            <EmptyDescription>{t(filtered ? 'evidence.segments.noMatches' : 'evidence.segments.empty')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul aria-label={t('evidence.segments.title')} className="max-h-48 space-y-1 overflow-y-auto p-0.5">
          {files.map((file) => {
            const key = `${file.startAt}|${file.endAt}`;
            return (
              <li key={key} className="min-w-0">
                <button type="button" aria-pressed={activeKey === key} onClick={() => onPlay(file)}
                  className={cn('flex min-h-14 w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none', activeKey === key && 'bg-accent text-primary')}>
                  <Play aria-hidden="true" className="size-4 shrink-0" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-control font-medium tabular-nums">{recordingClock(file, language)}</span>
                    <span className="flex flex-wrap gap-x-2 text-caption text-muted-foreground">
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

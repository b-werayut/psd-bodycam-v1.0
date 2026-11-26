import { useLanguage } from '@/i18n/useLanguage';
import { cn } from '@/lib/utils';
import type { RecordingFile } from '../../streaming/streaming.api';
import { formatDuration, recordingDayPosition } from '../evidenceRange';
import { recordingClock } from '../recordingPresentation';

export type SegmentsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; files: RecordingFile[] };

const HOURS = Array.from({ length: 25 }, (_, hour) => hour);

/** The ruler selects the same recording as the inspector list. */
export function RecordingSegmentsPanel({ state, date, activeKey, onPlay }: {
  state: SegmentsState;
  date: string;
  /** The original file's start/end, before clipping to the selected day. */
  activeKey: string | null;
  onPlay: (file: RecordingFile) => void;
}) {
  const { t, language } = useLanguage();
  const files = state.kind === 'ready' ? state.files : [];
  const clock = (file: RecordingFile) => recordingClock(file, language);
  const selected = files.find((file) => `${file.startAt}|${file.endAt}` === activeKey);
  const position = selected ? recordingDayPosition(selected, date) : null;

  return (
    <section aria-label={t('evidence.timeline.title')} className="evidence-recordings flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-title font-semibold">{t('evidence.timeline.title')}</h2>
          <p className="evidence-timeline-description mt-1 text-caption text-muted-foreground">{t('evidence.timeline.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-caption text-muted-foreground">
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

    </section>
  );
}

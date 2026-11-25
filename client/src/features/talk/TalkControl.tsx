import { useId } from 'react';
import { Loader2, Mic, MicOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { TranslationKey } from '@/i18n/locales/th';
import { useLanguage } from '@/i18n/useLanguage';
import { cn } from '@/lib/utils';
import { formatPillClock, formatTalkClock } from './talkRules';
import { TalkWaveform } from './TalkWaveform';
import type { TalkSession, TalkState } from './useTalkSession';

const PROGRESS_LABEL: Partial<Record<TalkState, TranslationKey>> = {
  'requesting-mic': 'talk.requestingMic',
  connecting: 'talk.connecting',
  ending: 'talk.ending',
};

type PillState = 'idle' | 'busy' | 'listening';

/**
 * ส่วนคุยผ่านกล้องทางซ้ายของ footer ใน LiveStreamDialog — แสดงผลอย่างเดียว สถานะมาจาก `useTalkSession`
 * `blocker` = เหตุผลที่กดเริ่มไม่ได้ (disable พร้อมเหตุผล ไม่ซ่อนปุ่ม)
 *
 * ปุ่มเป็น voice pill (React Bits) ตัวเดียวตลอดทุกสถานะ เพื่อให้แคปซูลพองออก/หุบกลับต่อเนื่อง:
 * พัก = วงกลมไมค์ · ระหว่างต่อสาย = spinner · คุยอยู่ = แคปซูลแถบคลื่น + เวลา + ปุ่มหยุด (กด = จบสาย)
 * สไตล์อยู่ใน `styles/global.css` (`.voice-pill*`)
 */
export function TalkControl({
  talk,
  blocker,
}: {
  talk: TalkSession;
  blocker: TranslationKey | null;
}) {
  const { t } = useLanguage();
  const hintId = useId();
  const progress = PROGRESS_LABEL[talk.state];
  const listening = talk.state === 'active';
  const pillState: PillState = listening ? 'listening' : progress ? 'busy' : 'idle';

  // "ลองใหม่" เฉพาะต่อสายไม่สำเร็จ · สายที่จบแล้ว (รวมกดวางสายเอง) กลับเป็นปุ่มเริ่มคุยตามเดิม
  const failed = talk.state === 'error';
  // แสดงข้อความท้ายสาย (ended / error) และข้อความ "ลองใหม่ภายหลัง" ตอนกลับ idle (409 busy)
  const notice =
    talk.notice
      ? 'text' in talk.notice
        ? talk.notice.text
        : t(talk.notice.key, talk.notice.params)
      : null;

  const pillLabel = t(listening ? 'talk.hangUp' : failed ? 'talk.retry' : 'talk.start');
  const muteLabel = t(talk.muted ? 'talk.unmute' : 'talk.mute');

  return (
    <div className="flex min-h-11 min-w-0 items-center gap-3">
      <div className="voice-pill-slot" data-state={pillState}>
        <button
          type="button"
          className="voice-pill"
          data-state={pillState}
          data-muted={listening && talk.muted ? '' : undefined}
          disabled={pillState === 'busy' || (pillState === 'idle' && blocker !== null)}
          aria-label={pillLabel}
          title={pillLabel}
          aria-describedby={pillState === 'idle' ? hintId : undefined}
          onClick={listening ? talk.hangUp : talk.start}
        >
          <span className="voice-pill__capsule" aria-hidden="true" />
          <TalkWaveform active={listening} muted={talk.muted} readLevel={talk.readLevel} />
          <span className="voice-pill__time" aria-hidden="true">
            {formatPillClock(talk.elapsedSeconds)}
          </span>
          <span className="voice-pill__glyph" aria-hidden="true">
            <span className="voice-pill__mic">
              <Mic className="size-5" strokeWidth={2} />
            </span>
            <span className="voice-pill__busy">
              {pillState === 'busy' ? (
                <Loader2 className="size-5 animate-spin motion-reduce:animate-none" />
              ) : null}
            </span>
            <span className="voice-pill__stop" />
          </span>
        </button>
      </div>

      {listening ? (
        <>
          <button
            type="button"
            className="voice-pill-aux"
            aria-pressed={talk.muted}
            aria-label={muteLabel}
            title={muteLabel}
            onClick={talk.toggleMute}
          >
            {talk.muted ? (
              <MicOff aria-hidden="true" className="size-[18px]" />
            ) : (
              <Mic aria-hidden="true" className="size-[18px]" />
            )}
          </button>
          <span
            role="meter"
            aria-label={t('talk.micLevel')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(talk.micLevel * 100)}
            className="sr-only"
          />
          <span className="sr-only">
            {t('talk.active', {
              elapsed: formatTalkClock(talk.elapsedSeconds),
              max: formatTalkClock(talk.maxSeconds ?? 0),
            })}
          </span>
        </>
      ) : progress ? (
        <>
          <span role="status" className="text-sm text-muted-foreground">
            {t(progress)}
          </span>
          {talk.state === 'connecting' ? (
            <Button type="button" variant="ghost" size="sm" onClick={talk.hangUp}>
              {t('talk.cancel')}
            </Button>
          ) : null}
        </>
      ) : (
        <div id={hintId} className="min-w-0 text-xs">
          {notice ? (
            <p
              role={talk.state === 'error' ? 'alert' : 'status'}
              className={cn(
                'font-medium',
                talk.state === 'error' ? 'text-destructive' : 'text-foreground',
              )}
            >
              {notice}
            </p>
          ) : null}
          <p className="text-muted-foreground">{t(blocker ?? 'talk.headsetHint')}</p>
        </div>
      )}
    </div>
  );
}

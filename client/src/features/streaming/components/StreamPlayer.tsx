import { useEffect, useRef, useState } from 'react';
import type HlsType from 'hls.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Eye, Loader2, ShieldAlert, TriangleAlert, VideoOff } from 'lucide-react';
import { toast } from 'sonner';

import { actionToast } from '@/components/ui/action-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';
import { backendMessage } from '@/lib/apiError';
import { cn } from '@/lib/utils';
import { useRealtime } from '@/providers/RealtimeProvider';
import {
  canPlayNativeHls,
  hasMediaSource,
  playbackErrorText,
  playbackMode,
  type LiveTarget,
} from '../livePlayer';
import {
  STREAM_END_REASON,
  STREAM_STATUS,
  streamingApi,
  type LiveSession,
  type StreamStatusEvent,
} from '../streaming.api';
import { settlePendingStops, stopStream, stopStreamOnPageHide } from '../streamStops';

export function StreamPlayer({
  device,
  playback,
  className,
  onSessionChange,
  forceMuted = false,
  compact = false,
  fill = false,
  quietErrors = false,
  errorFeedback = 'inline',
}: {
  device: LiveTarget;
  playback?: { startAt: string; endAt: string };
  className?: string;
  /** live session ที่พร้อมใช้งาน (null = ภาพยังไม่พร้อม · server ปิดจอแล้ว · โหมด playback) — สายคุยผูกกับค่านี้ */
  onSessionChange?: (session: LiveSession | null) => void;
  /** ระหว่างคุยผ่านกล้อง บังคับ mute วิดีโอ — เสียง HLS หน่วงหลายวินาทีจะซ้อนกับเสียงจากช่อง talk */
  forceMuted?: boolean;
  /** หน้าดูหลายจอ: ซ่อนแถบโควตา/คำเตือน audit/idle ของแต่ละจอ — หน้านั้นแสดงรวมครั้งเดียว */
  compact?: boolean;
  /**
   * ภาพเต็มช่องของผู้เรียก แทนสัดส่วน 16:9 ตายตัว (ช่องตารางของหน้าดูหลายจอ) · ข้อผิดพลาดลอยทับภาพ
   * ไม่ดันภาพให้เตี้ยลง เพราะช่องเล็กมีที่ให้ไม่พอ
   */
  fill?: boolean;
  /**
   * หน้าดูหลายจอ: ขอภาพ/เล่นภาพไม่สำเร็จ = แสดงแค่ไอคอนกล้อง + "ไม่พบสัญญาณ" และปุ่มลองใหม่ (ผู้ใช้สั่ง 2026-10-15)
   * ไม่แสดงข้อความจาก DSS/middleware ในจอเล็ก · เกินโควตา (429) ยังบอกสั้น ๆ เพราะผู้ใช้แก้เองได้ (ปิดจออื่น)
   */
  quietErrors?: boolean;
  /** Toast feedback keeps standalone playback errors from shifting the video. */
  errorFeedback?: 'inline' | 'toast';
}) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [session, setSession] = useState<LiveSession | null>(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [quotaFull, setQuotaFull] = useState(false);
  const [ended, setEnded] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const mounted = useRef(false);
  const frameRequestRef = useRef<{ video: HTMLVideoElement; id: number } | null>(null);

  const markMediaReady = () => {
    const video = videoRef.current;
    if (!video || mediaReady || frameRequestRef.current) return;

    if (typeof video.requestVideoFrameCallback === 'function') {
      const id = video.requestVideoFrameCallback(() => {
        frameRequestRef.current = null;
        setMediaReady(true);
      });
      frameRequestRef.current = { video, id };
      return;
    }

    setMediaReady(true);
  };

  const sessions = useQuery({
    queryKey: ['streamSessions'],
    queryFn: streamingApi.mySessions,
    staleTime: 0,
    gcTime: 0,
    // จอย่อยในหน้าดูหลายจอไม่แสดงโควตาเอง — หน้านั้นถือ query นี้ไว้ที่เดียว ไม่ต้องยิงซ้ำทุกจอ
    enabled: !compact,
  });

  const start = useMutation({
    mutationFn: async () => {
      await settlePendingStops();
      return playback
        ? streamingApi.startPlayback({
            DeviceCode: device.deviceCode,
            StartAt: playback.startAt,
            EndAt: playback.endAt,
          })
        : streamingApi.startLive({ DeviceCode: device.deviceCode });
    },
    onSuccess: (data) => {
      if (!mounted.current) {
        void stopStream(data.sessionToken);
        return;
      }
      setError(null);
      setQuotaFull(false);
      setMediaReady(false);
      setSession(data);
      tokenRef.current = data.sessionToken;
      void queryClient.invalidateQueries({ queryKey: ['streamSessions'] });
    },
    onError: (startError) => {
      setError(backendMessage(startError) ?? t('streaming.startFailed'));
      setQuotaFull(startError instanceof AxiosError && startError.response?.status === 429);
      // session ที่ล้มเคยนับเป็น "เปิดอยู่" ระหว่างรอ vendor — ไม่รีเฟรช = ตัวเลขโควตาค้างเกินจริง
      void queryClient.invalidateQueries({ queryKey: ['streamSessions'] });
    },
  });

  const requested = useRef(false);
  useEffect(() => {
    mounted.current = true;
    if (requested.current) return;
    requested.current = true;
    start.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      mounted.current = false;
      const frameRequest = frameRequestRef.current;
      frameRequestRef.current = null;
      if (frameRequest && typeof frameRequest.video.cancelVideoFrameCallback === 'function') {
        frameRequest.video.cancelVideoFrameCallback(frameRequest.id);
      }

      const token = tokenRef.current;
      tokenRef.current = null;
      if (!token) return;
      // หน้าที่ยังเปิดอยู่ (ดูหลายจอ) ต้องเห็นโควตาลดลงหลังปิดจอ
      void stopStream(token).then(() =>
        queryClient.invalidateQueries({ queryKey: ['streamSessions'] }),
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPageHide = () => {
      const token = tokenRef.current;
      if (!token) return;
      tokenRef.current = null;
      stopStreamOnPageHide(token);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  const { subscribe } = useRealtime();
  useEffect(() => {
    if (!session) return;
    return subscribe<StreamStatusEvent>('stream:status', (event) => {
      if (event.sessionToken !== session.sessionToken) return;
      if (event.status !== STREAM_STATUS.ENDED) return;
      tokenRef.current = null;
      setEnded(true);
      setPlaybackError(
        t(
          event.endReason === STREAM_END_REASON.POLICY_DISABLED
            ? 'streaming.endedByPolicy'
            : 'streaming.endedRemotely',
        ),
      );
    });
  }, [session, subscribe, t]);

  // เปิดให้เริ่มคุยเมื่อ HLS วาดเฟรมแรกแล้วเท่านั้น; หลังพร้อมแล้ว playback error ไม่ตัดสายที่กำลังคุย
  const liveSession = !playback && session && mediaReady && !ended ? session : null;
  useEffect(() => {
    onSessionChange?.(liveSession);
  }, [liveSession, onSessionChange]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !session) return;

    let player: HlsType | null = null;
    let cancelled = false;
    // native ไม่มี event error ของ hls.js — ไม่ฟังตรงนี้ = เล่นไม่ได้แล้วค้างหน้า "กำลังเชื่อมต่อ" ตลอดไป
    const onNativeError = () =>
      setPlaybackError(playbackErrorText(t('streaming.playbackFailed'), video.error?.message));

    void (async () => {
      const Hls = hasMediaSource(window) ? (await import('hls.js')).default : null;
      if (cancelled) return;
      const mode = playbackMode({
        canPlayNativeHls: canPlayNativeHls(video),
        hlsJsSupported: Hls?.isSupported() ?? false,
      });
      if (mode === 'none') {
        setPlaybackError(t('streaming.unsupported'));
        return;
      }

      if (mode === 'native' || !Hls) {
        video.addEventListener('error', onNativeError);
        video.src = session.playbackUrl;
        void video.play().catch(() => undefined);
        return;
      }

      player = new Hls({ enableWorker: true });
      player.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setPlaybackError(playbackErrorText(t('streaming.playbackFailed'), data.details));
        }
      });
      player.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => undefined);
      });
      player.loadSource(session.playbackUrl);
      player.attachMedia(video);
    })();

    return () => {
      cancelled = true;
      video.removeEventListener('error', onNativeError);
      player?.destroy();
    };
  }, [session, t]);

  const hasPlayableSession = session !== null && !playbackError;

  useEffect(() => {
    const video = videoRef.current;
    if (!forceMuted || !video) return;
    video.muted = true;
    const keepMuted = () => {
      if (!video.muted) video.muted = true;
    };
    video.addEventListener('volumechange', keepMuted);
    return () => video.removeEventListener('volumechange', keepMuted);
    // `hasPlayableSession` อยู่ใน deps เพราะ <video> เพิ่ง mount ตอนค่านี้เป็น true
  }, [forceMuted, hasPlayableSession]);

  /** ลองใหม่จากจอเงียบ — ภาพที่เล่นไม่ได้ต้องปิด session เดิมก่อน ไม่งั้นกินโควตาซ้อน */
  const retryQuietly = () => {
    const token = tokenRef.current;
    tokenRef.current = null;
    if (token) void stopStream(token);
    setSession(null);
    setMediaReady(false);
    setEnded(false);
    setPlaybackError(null);
    setError(null);
    setQuotaFull(false);
    start.mutate();
  };
  const failed = Boolean(error || playbackError);
  const isPlayback = playback !== undefined;
  const connectingText = t(playback ? 'evidence.player.connecting' : 'streaming.connecting');

  useEffect(() => {
    if (errorFeedback !== 'toast' || quietErrors || (!error && !playbackError)) return;
    const title = error
      ? t(isPlayback ? 'evidence.error.playback' : 'streaming.startFailed')
      : t('streaming.playbackFailed');
    const toastId = actionToast.error(title, error ?? playbackError ?? undefined);
    return () => { toast.dismiss(toastId); };
  }, [errorFeedback, quietErrors, error, playbackError, isPlayback, t]);

  return (
    <div className={cn('flex flex-col', fill && 'relative h-full min-h-0', className)}>
      {failed && !quietErrors && errorFeedback === 'inline' ? (
        <div
          className={cn(
            'flex flex-col gap-2',
            fill
              ? 'absolute inset-0 z-20 overflow-y-auto bg-background/95 p-2'
              : 'border-b border-border px-4 py-3',
          )}
        >
          {error ? (
            <Alert variant="destructive" feedbackScope="operational">
              <TriangleAlert aria-hidden="true" />
              <div>
                <AlertTitle>{t(playback ? 'evidence.error.playback' : 'streaming.startFailed')}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 min-h-11"
                  onClick={() => {
                    setError(null);
                    start.mutate();
                  }}
                  disabled={start.isPending}
                >
                  {t('streaming.retry')}
                </Button>
              </div>
            </Alert>
          ) : null}

          {playbackError ? (
            <Alert variant="destructive" feedbackScope="operational">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>{t('streaming.playbackFailed')}</AlertTitle>
              <AlertDescription>{playbackError}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          'stream-stage relative grid w-full place-items-center',
          fill ? 'min-h-0 flex-1' : 'aspect-video',
        )}
      >
        {hasPlayableSession ? (
          <video
            ref={videoRef}
            className="absolute inset-0 size-full object-contain"
            controls={mediaReady}
            autoPlay
            muted
            playsInline
            onLoadedData={markMediaReady}
            onPlaying={markMediaReady}
            aria-label={
              playback
                ? t('evidence.player.videoLabel', { camera: device.deviceName || device.deviceCode })
                : t('streaming.videoLabel')
            }
          />
        ) : (
          <div className="flex flex-col items-center px-6 text-center">
            {start.isPending && !error ? (
              <>
                <Loader2 aria-hidden="true" className="size-9 animate-spin" />
                <p className="mt-3 text-caption">{connectingText}</p>
              </>
            ) : quietErrors && failed ? (
              <>
                <VideoOff
                  aria-hidden="true"
                  size={44}
                  strokeWidth={1.5}
                  className="stream-stage__icon"
                />
                <p role="status" className="stream-stage__title mt-3 text-sm font-medium">
                  {t(quotaFull && error ? 'streaming.quotaFullShort' : 'streaming.noSignalShort')}
                </p>
                <button
                  type="button"
                  onClick={retryQuietly}
                  disabled={start.isPending}
                  className="stream-stage__action mt-3 min-h-9 rounded-md px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {t('streaming.retry')}
                </button>
              </>
            ) : (
              <>
                <VideoOff
                  aria-hidden="true"
                  size={52}
                  strokeWidth={1.5}
                  className="stream-stage__icon"
                />
                <p className="stream-stage__title mt-4 text-control font-medium">
                  {playback
                    ? ended
                      ? t('evidence.player.ended')
                      : (error ?? playbackError ?? t('evidence.error.playback'))
                    : t('streaming.noSignal')}
                </p>
                {playback ? null : (
                  <p className="stream-stage__hint mt-1.5 text-caption">
                    {t('streaming.noSignalHint')}
                  </p>
                )}
              </>
            )}
          </div>
        )}
        {hasPlayableSession && !mediaReady ? (
          <div
            role="status"
            className="stream-stage absolute inset-0 z-10 flex flex-col items-center justify-center px-6 text-center"
          >
            <Loader2 aria-hidden="true" className="size-9 animate-spin" />
            <p className="mt-3 text-caption">{connectingText}</p>
          </div>
        ) : null}
      </div>

      {compact ? null : (
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-2.5 text-caption text-muted-foreground">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {hasPlayableSession && session ? (
              <span className="flex items-center gap-1.5 font-semibold tracking-[0.06em] text-foreground">
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-1.5 rounded-full',
                    playback ? 'bg-muted-foreground' : 'bg-destructive',
                  )}
                />
                {t(playback ? 'streaming.channelPlayback' : 'streaming.channelLive', {
                  channel: session.channel,
                })}
              </span>
            ) : null}
            <span className="flex items-center gap-1.5">
              <Eye aria-hidden="true" size={15} strokeWidth={1.5} />
              {sessions.data
                ? t('streaming.quota', {
                    open: sessions.data.data.length,
                    limit: sessions.data.limit,
                  })
                : '—'}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldAlert aria-hidden="true" size={15} strokeWidth={1.5} />
            {t('streaming.auditNotice')}
          </span>
        </div>
      )}

      {session && !compact ? (
        <p className="px-4 py-2 text-caption text-muted-foreground">
          {t(playback ? 'evidence.player.idleHint' : 'streaming.idleHint', {
            seconds: session.idleTimeoutSeconds,
          })}
        </p>
      ) : null}
    </div>
  );
}

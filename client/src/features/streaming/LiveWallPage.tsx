import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, LazyMotion, domMax, m } from 'motion/react';
import { Eye, Maximize2, Minimize2 } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TalkControl } from '@/features/talk/TalkControl';
import { browserSupportsTalk, TALK_PERMISSION, talkBlockerOf } from '@/features/talk/talkRules';
import { isTalkBusy, useTalkSession } from '@/features/talk/useTalkSession';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import { normalizedDeviceName } from '@/lib/deviceName';
import { usePermission } from '@/lib/usePermission';
import { LAYOUT_TRANSITION, tileVariants } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { LayoutGlyph } from './components/LayoutGlyph';
import { LiveWallCameraList } from './components/LiveWallCameraList';
import { LiveWallTile } from './components/LiveWallTile';
import { gridShapeFor, layoutBlocker, LIVE_WALL_LAYOUTS, nextEmptySlot, paramsWithSlots, slotsFromParams, wallCameraBlocker, wallSlotState, withCameraPlaced, withLayout, withSlot, type WallSlots } from './liveWall';
import { streamingApi, type LiveSession } from './streaming.api';

/** Adapted from Internal-BodyCam: camera rail, fixed screen slots and HLS players. */
export function LiveWallPage() {
  const { t } = useLanguage();
  const titleId = useId();
  const [params, setParams] = useSearchParams();
  const slots = useMemo(() => slotsFromParams(params), [params]);
  const [selected, setSelected] = useState(0);
  const selectedIndex = Math.min(selected, slots.length - 1);
  const devices = useQuery({ queryKey: ['devices', 'live-wall'], queryFn: streamingApi.devices, refetchInterval: 30_000 });
  const sessions = useQuery({ queryKey: ['streamSessions'], queryFn: streamingApi.mySessions, refetchInterval: 10_000, retry: false });
  const limit = sessions.data?.limit;
  const updateSlots = useCallback((update: (previous: WallSlots) => WallSlots) =>
    setParams((previous) => paramsWithSlots(previous, update(slotsFromParams(previous))), { replace: true }), [setParams]);

  const placeable = (code: string) => {
    const device = devices.data?.find((row) => row.deviceCode === code);
    return Boolean(device && !wallCameraBlocker(device));
  };
  const pickCamera = (code: string) => {
    const existing = slots.indexOf(code);
    if (existing !== -1) return setSelected(existing);
    if (!placeable(code)) return;
    const next = withSlot(slots, selectedIndex, code);
    updateSlots((previous) => withSlot(previous, selectedIndex, code));
    const empty = nextEmptySlot(next, selectedIndex);
    if (empty !== -1) setSelected(empty);
  };

  // Live sessions per screen; one call per page (one microphone).
  const [liveByCode, setLiveByCode] = useState<Readonly<Record<string, LiveSession>>>({});
  const onLiveSessionChange = useCallback((code: string, session: LiveSession | null) => {
    setLiveByCode((previous) => {
      if (session) return previous[code] === session ? previous : { ...previous, [code]: session };
      if (!(code in previous)) return previous;
      const next = { ...previous };
      delete next[code];
      return next;
    });
  }, []);
  // The call locks to the session picked at start; moving the selection must not drop it.
  // A closed tile hands null to the hook, which hangs up.
  const [callToken, setCallToken] = useState<string | null>(null);
  const selectedCode = slots[selectedIndex] ?? null;
  const callCode = callToken ? (Object.keys(liveByCode).find((code) => liveByCode[code].sessionToken === callToken) ?? null) : null;
  const selectedSession = selectedCode ? (liveByCode[selectedCode] ?? null) : null;
  const talkToken = callToken ? (callCode ? callToken : null) : (selectedSession?.sessionToken ?? null);
  const talk = useTalkSession(talkToken);
  const talkBusy = isTalkBusy(talk.state);
  useEffect(() => {
    if (talkBusy) setCallToken((previous) => previous ?? talkToken);
    else setCallToken(null);
  }, [talkBusy, talkToken]);
  const canTalk = usePermission(TALK_PERMISSION);
  const talkCode = talkBusy ? callCode : selectedCode;
  const talkSlotNo = talkCode ? slots.indexOf(talkCode) + 1 : 0;
  const talkDevice = talkCode ? devices.data?.find((row) => row.deviceCode === talkCode) : undefined;
  const talkBlocker = talkBlockerOf({ canTalk, supported: browserSupportsTalk(window), liveReady: talkToken !== null, targetMissing: !talkBusy && !selectedCode });

  const wallRef = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === wallRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void wallRef.current?.requestFullscreen?.().catch(() => undefined);
  };
  const { columns, rows } = gridShapeFor(slots.length);
  const gridStyle = { '--wall-cols': columns, '--wall-rows': rows } as CSSProperties;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <LiveWallCameraList devices={devices.data} isLoading={devices.isPending}
        error={devices.isError ? apiErrorOf(devices.error, t).message : null}
        onRetry={() => void devices.refetch()} slots={slots} onPick={pickCamera}>
        {canTalk ? (
        <div data-slot="live-wall-talk" className="shrink-0 border-t border-border px-3 py-3">
          <h2 className="text-sm font-semibold text-foreground">{t('liveWall.talk.title')}</h2>
          <p className="mb-2 mt-0.5 truncate text-xs text-muted-foreground">
            {talkCode && talkSlotNo > 0 ? t('liveWall.talk.target', { n: talkSlotNo, camera: normalizedDeviceName(talkDevice?.name) ?? talkCode }) : t('liveWall.talk.noTarget')}
          </p>
          <TalkControl talk={talk} blocker={talkBlocker} />
        </div>
        ) : null}
      </LiveWallCameraList>
      <section ref={wallRef} aria-labelledby={titleId} className="flex min-w-0 flex-1 flex-col bg-background lg:min-h-0">
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2">
          <h1 id={titleId} className="text-base font-semibold">{t('liveWall.title')}</h1>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Eye aria-hidden="true" className="size-4" />{sessions.data ? t('streaming.quota', { open: sessions.data.data.length, limit: limit ?? 0 }) : '—'}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t('liveWall.layout.label')} className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
              {LIVE_WALL_LAYOUTS.map((count) => {
                const blocker = layoutBlocker(count, limit);
                const label = t('liveWall.layout.option', { n: count });
                return <button key={count} type="button" aria-label={label} aria-pressed={slots.length === count}
                  title={blocker ? t(blocker.key, blocker.params) : label} disabled={Boolean(blocker)}
                  onClick={() => { updateSlots((previous) => withLayout(previous, count)); setSelected((current) => Math.min(current, count - 1)); }}
                  className={cn('grid size-11 place-items-center rounded text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [@media(pointer:fine)]:size-9', slots.length === count && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground')}><LayoutGlyph count={count} /></button>;
              })}
            </div>
            <Button type="button" variant="outline" size="sm" disabled={!slots.some(Boolean)} onClick={() => updateSlots((previous) => previous.map(() => null))}>{t('liveWall.closeAll')}</Button>
            {document.fullscreenEnabled ? <Button type="button" variant="ghost" size="icon" aria-label={t(fullscreen ? 'liveWall.fullscreen.exit' : 'liveWall.fullscreen.enter')} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</Button> : null}
          </div>
        </div>
        {sessions.isError ? <Alert variant="destructive" className="m-2 w-auto"><AlertDescription>{apiErrorOf(sessions.error, t).message}</AlertDescription></Alert> : null}
        {limit !== undefined && slots.length > limit ? <Alert className="m-2 w-auto"><AlertDescription>{t('liveWall.quotaLimited', { limit })}</AlertDescription></Alert> : null}
        <LazyMotion features={domMax}>
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:[scrollbar-gutter:stable]">
            {/* Three rows keep at least the six-screen tile height; the final row scrolls into view. */}
            <div role="group" aria-label={t('liveWall.gridLabel')} data-columns={columns} data-rows={rows} style={gridStyle}
              className={cn('relative grid grid-cols-1 gap-1.5 p-1.5', slots.length > 1 && 'md:grid-cols-2', 'lg:h-full lg:[grid-template-columns:repeat(var(--wall-cols),minmax(0,1fr))] lg:[grid-template-rows:repeat(var(--wall-rows),minmax(0,1fr))]', slots.length === 9 && 'lg:min-h-[150%]')}>
              <AnimatePresence initial={false} mode="popLayout">
                {slots.map((code, index) => <m.div key={index} layout variants={tileVariants} initial="hidden" animate="visible" exit="exit" transition={{ layout: LAYOUT_TRANSITION }} className="min-h-0 min-w-0 self-start lg:self-stretch">
                  <LiveWallTile slotNo={index + 1} state={wallSlotState(code, devices.data)} selected={index === selectedIndex}
                    talking={talkBusy && code !== null && code === callCode} muteAll={talkBusy} onLiveSessionChange={onLiveSessionChange}
                    onSelect={() => setSelected(index)} onClear={() => updateSlots((previous) => withSlot(previous, index, null))}
                    onDropCamera={(dropped) => { if (!placeable(dropped)) return; updateSlots((previous) => withCameraPlaced(previous, index, dropped)); setSelected(index); }} />
                </m.div>)}
              </AnimatePresence>
            </div>
          </div>
        </LazyMotion>
      </section>
    </div>
  );
}

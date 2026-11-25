import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, LazyMotion, domMax, m } from 'motion/react';
import { Eye, Maximize2, Minimize2 } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import { LAYOUT_TRANSITION, tileVariants } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { LayoutGlyph } from './components/LayoutGlyph';
import { LiveWallCameraList } from './components/LiveWallCameraList';
import { LiveWallTile } from './components/LiveWallTile';
import { gridShapeFor, layoutBlocker, LIVE_WALL_LAYOUTS, nextEmptySlot, paramsWithSlots, slotsFromParams, wallCameraBlocker, wallSlotState, withCameraPlaced, withLayout, withSlot, type WallSlots } from './liveWall';
import { streamingApi } from './streaming.api';

const noSessionChange = () => undefined;

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
        onRetry={() => void devices.refetch()} slots={slots} onPick={pickCamera} />
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
          <div role="group" aria-label={t('liveWall.gridLabel')} data-columns={columns} data-rows={rows} style={gridStyle}
            className={cn('relative grid flex-1 grid-cols-1 gap-1.5 p-1.5', slots.length > 1 && 'md:grid-cols-2', 'lg:min-h-0 lg:[grid-template-columns:repeat(var(--wall-cols),minmax(0,1fr))] lg:[grid-template-rows:repeat(var(--wall-rows),minmax(0,1fr))]')}>
            <AnimatePresence initial={false} mode="popLayout">
              {slots.map((code, index) => <m.div key={index} layout variants={tileVariants} initial="hidden" animate="visible" exit="exit" transition={{ layout: LAYOUT_TRANSITION }} className="min-h-0 min-w-0 self-start lg:self-stretch">
                <LiveWallTile slotNo={index + 1} state={wallSlotState(code, devices.data)} selected={index === selectedIndex}
                  talking={false} muteAll={false} onLiveSessionChange={noSessionChange}
                  onSelect={() => setSelected(index)} onClear={() => updateSlots((previous) => withSlot(previous, index, null))}
                  onDropCamera={(dropped) => { if (!placeable(dropped)) return; updateSlots((previous) => withCameraPlaced(previous, index, dropped)); setSelected(index); }} />
              </m.div>)}
            </AnimatePresence>
          </div>
        </LazyMotion>
      </section>
    </div>
  );
}

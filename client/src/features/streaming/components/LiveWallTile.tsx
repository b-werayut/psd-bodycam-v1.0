import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { Loader2, Mic, MonitorPlay, TriangleAlert, VideoOff, X } from 'lucide-react';

import { normalizedDeviceName } from '@/lib/deviceName';
import { useLanguage } from '@/i18n/useLanguage';
import { cn } from '@/lib/utils';
import type { LiveTarget } from '../livePlayer';
import type { WallSlotState } from '../liveWall';
import type { LiveSession } from '../streaming.api';
import { WALL_CAMERA_MIME } from './LiveWallCameraList';
import { StreamPlayer } from './StreamPlayer';

/** ภาพของกล้องหนึ่งตัว — key ตามรหัสกล้อง เปลี่ยนกล้อง = session ใหม่ และหน้าต้องรู้ว่า session เดิมไม่อยู่แล้ว */
function LiveWallScreen({
  target,
  muteAll,
  onLiveChange,
  onLiveSessionChange,
}: {
  target: LiveTarget;
  /** มีสายคุยอยู่ — เสียงจากลำโพงของทุกจอจะเข้าไมค์แล้วไปออกที่กล้อง */
  muteAll: boolean;
  onLiveChange: (live: boolean) => void;
  onLiveSessionChange: (deviceCode: string, session: LiveSession | null) => void;
}) {
  const { deviceCode } = target;
  // ใช้ callback ตัวล่าสุดเสมอ — StreamPlayer แจ้งซ้ำทุกครั้งที่ identity ของ callback เปลี่ยน
  const callbacks = useRef({ onLiveChange, onLiveSessionChange });
  callbacks.current = { onLiveChange, onLiveSessionChange };
  const [onSessionChange] = useState(() => (session: LiveSession | null) => {
    callbacks.current.onLiveChange(session !== null);
    callbacks.current.onLiveSessionChange(deviceCode, session);
  });

  // ปิดภาพ / เปลี่ยนกล้อง: session นี้หมดแล้ว — ไม่แจ้ง = สายคุยยังชี้ไปที่ session ที่ตายแล้ว
  useEffect(
    () => () => {
      callbacks.current.onLiveChange(false);
      callbacks.current.onLiveSessionChange(deviceCode, null);
    },
    [deviceCode],
  );

  return (
    <StreamPlayer
      compact
      fill
      quietErrors
      device={target}
      onSessionChange={onSessionChange}
      forceMuted={muteAll}
    />
  );
}

function hasCamera(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(WALL_CAMERA_MIME);
}

/**
 * จอหนึ่งช่องแบบโปรแกรม monitor — คลิกที่ไหนก็ได้เพื่อเลือกจอ (กรอบสีน้ำเงิน) · รับกล้องที่ลากมาวาง
 * ปุ่ม × = ปิดภาพของจอนี้ (จอยังอยู่ — จำนวนจอเปลี่ยนด้วยรูปแบบการแบ่งจอเท่านั้น)
 */
export function LiveWallTile({
  slotNo,
  state,
  selected,
  talking,
  muteAll,
  onSelect,
  onClear,
  onDropCamera,
  onLiveSessionChange,
}: {
  slotNo: number;
  state: WallSlotState;
  selected: boolean;
  /** จอนี้มีสายคุยอยู่ */
  talking: boolean;
  muteAll: boolean;
  onSelect: () => void;
  onClear: () => void;
  onDropCamera: (deviceCode: string) => void;
  onLiveSessionChange: (deviceCode: string, session: LiveSession | null) => void;
}) {
  const { t } = useLanguage();
  const headingId = useId();
  const [live, setLive] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const code = state.kind === 'empty' ? null : state.code;
  const name =
    state.kind === 'ready' || state.kind === 'blocked' || state.kind === 'offline'
      ? (normalizedDeviceName(state.device.name) ?? state.code)
      : code;

  return (
    <section
      aria-labelledby={headingId}
      data-slot="live-wall-tile"
      data-selected={selected ? 'true' : undefined}
      onPointerDown={onSelect}
      onDragOver={(event) => {
        if (!hasCamera(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        setDragOver(false);
        if (!hasCamera(event)) return;
        event.preventDefault();
        const dropped = event.dataTransfer.getData(WALL_CAMERA_MIME);
        if (dropped) onDropCamera(dropped);
      }}
      className={cn(
        'flex h-full min-h-0 flex-col overflow-hidden rounded-md border-2 bg-card transition-colors motion-reduce:transition-none',
        selected ? 'border-primary' : 'border-border',
        dragOver && 'border-info',
      )}
    >
      <header className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-1.5">
        <h2 id={headingId} className="min-w-0 flex-1">
          <button
            type="button"
            aria-pressed={selected}
            onClick={onSelect}
            className="flex min-h-8 w-full min-w-0 items-center gap-1.5 rounded px-1 text-left text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="shrink-0">{t('liveWall.slot', { n: slotNo })}</span>
            {name ? (
              <span className="min-w-0 truncate font-normal text-muted-foreground">· {name}</span>
            ) : null}
          </button>
        </h2>
        {talking ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-xs font-semibold text-info">
            <Mic aria-hidden="true" className="size-3" />
            {t('liveWall.talking')}
          </span>
        ) : null}
        {live && state.kind === 'ready' ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold tracking-[0.06em] text-destructive">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
            {t('liveWall.live')}
          </span>
        ) : null}
        <button
          type="button"
          aria-label={t('liveWall.clearScreen', { n: slotNo })}
          title={t('liveWall.clearScreen', { n: slotNo })}
          disabled={!code}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onClear();
          }}
          className="grid size-11 shrink-0 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 lg:size-7"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </header>

      <div className="relative aspect-video lg:aspect-auto lg:min-h-0 lg:flex-1">
        <div className="absolute inset-0">
          {state.kind === 'ready' ? (
            <LiveWallScreen
              key={state.code}
              target={state.target}
              muteAll={muteAll}
              onLiveChange={setLive}
              onLiveSessionChange={onLiveSessionChange}
            />
          ) : (
            <div className="stream-stage grid h-full w-full place-items-center">
              <div className="flex flex-col items-center px-4 text-center">
                {state.kind === 'loading' ? (
                  <>
                    <Loader2 aria-hidden="true" className="size-8 animate-spin" />
                    <p className="mt-3 text-caption">{t('common.loading')}</p>
                  </>
                ) : state.kind === 'offline' ? (
                  <>
                    <VideoOff
                      aria-hidden="true"
                      size={44}
                      strokeWidth={1.5}
                      className="stream-stage__icon"
                    />
                    <p role="status" className="stream-stage__title mt-3 text-sm font-medium">
                      {t('streaming.noSignalShort')}
                    </p>
                    <p className="stream-stage__hint mt-1 text-caption">
                      {t(state.status === 'unknown' ? 'liveWall.unknownHint' : 'liveWall.offlineHint')}
                    </p>
                  </>
                ) : state.kind === 'empty' ? (
                  <>
                    <MonitorPlay
                      aria-hidden="true"
                      size={40}
                      strokeWidth={1.5}
                      className="stream-stage__icon"
                    />
                    <p className="stream-stage__title mt-3 text-sm font-medium">
                      {t('liveWall.empty')}
                    </p>
                    <p className="stream-stage__hint mt-1 text-caption">
                      {t('liveWall.emptyHint')}
                    </p>
                  </>
                ) : (
                  <>
                    <TriangleAlert
                      aria-hidden="true"
                      size={36}
                      strokeWidth={1.5}
                      className="stream-stage__icon"
                    />
                    <p role="status" className="stream-stage__title mt-3 text-sm font-medium">
                      {state.kind === 'missing'
                        ? t('liveWall.missing', { code: state.code })
                        : t(state.reason)}
                    </p>
                    {state.kind === 'missing' ? (
                      <p className="stream-stage__hint mt-1 text-caption">
                        {t('liveWall.missingHint')}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        {dragOver ? (
          <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-info/15 text-sm font-semibold text-foreground">
            {t('liveWall.dropHere')}
          </div>
        ) : null}
      </div>
    </section>
  );
}

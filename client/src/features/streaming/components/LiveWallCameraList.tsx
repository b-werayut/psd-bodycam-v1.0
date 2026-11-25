import { Camera, TriangleAlert } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';

import { LoadingSkeleton } from '@/components/command-center/LoadingSkeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/i18n/useLanguage';
import { cn } from '@/lib/utils';
import { wallCameraBlocker, type WallSlots } from '../liveWall';
import type { WallDevice } from '../streaming.api';

export const WALL_CAMERA_MIME = 'application/x-bodycam-device';
const rank = { online: 0, unknown: 1, offline: 2 };

export function LiveWallCameraList({ devices, isLoading, error, onRetry, slots, onPick }: {
  devices: readonly WallDevice[] | undefined;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  slots: WallSlots;
  onPick: (code: string) => void;
}) {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const cameras = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (devices ?? []).filter((device) =>
      (device.status !== 4 || slots.includes(device.deviceCode)) &&
      (!term || device.deviceCode.toLowerCase().includes(term) || (device.name ?? '').toLowerCase().includes(term)),
    ).sort((a, b) => rank[a.platformState] - rank[b.platformState] || (a.name ?? a.deviceCode).localeCompare(b.name ?? b.deviceCode, 'th'));
  }, [devices, search, slots]);

  const drag = (event: DragEvent<HTMLButtonElement>, code: string) => {
    event.dataTransfer.setData(WALL_CAMERA_MIME, code);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside aria-label={t('liveWall.list.title')} className="flex max-h-[34dvh] shrink-0 flex-col border-b border-border bg-card lg:h-full lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
      <div className="shrink-0 px-3 pb-2 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('liveWall.list.title')}</h2>
          {devices ? <span className="text-xs text-muted-foreground">{t('liveWall.list.count', { online: cameras.filter((device) => device.platformState === 'online').length, total: cameras.length })}</span> : null}
        </div>
        <Input type="search" className="mt-2" aria-label={t('liveWall.list.search')} placeholder={t('liveWall.list.search')} value={search} onChange={(event) => setSearch(event.target.value)} />
        <p className="mt-1.5 text-xs text-muted-foreground">{t('liveWall.list.hint')}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {error ? (
          <Alert variant="destructive"><TriangleAlert aria-hidden="true" /><AlertTitle>{t('liveWall.devicesFailed')}</AlertTitle><AlertDescription>{error}</AlertDescription><Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>{t('common.retry')}</Button></Alert>
        ) : isLoading ? <LoadingSkeleton loadingLabel={t('common.loading')} /> : cameras.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">{t(search.trim() ? 'liveWall.list.empty' : 'liveWall.list.none')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {cameras.map((device) => {
              const blocker = wallCameraBlocker(device);
              const slot = slots.indexOf(device.deviceCode);
              return (
                <li key={device.id}>
                  <button type="button" disabled={Boolean(blocker)} draggable={!blocker}
                    onDragStart={(event) => drag(event, device.deviceCode)} onClick={() => onPick(device.deviceCode)}
                    className={cn('flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60', slot !== -1 && 'bg-primary/5', !blocker && 'cursor-grab active:cursor-grabbing')}>
                    <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', device.platformState === 'online' ? 'bg-success' : device.platformState === 'offline' ? 'bg-muted-foreground' : 'border border-muted-foreground')} />
                    <Camera aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" title={device.name ?? device.deviceCode}>{device.name?.trim() || device.deviceCode}</span>
                      <span className="block truncate text-xs text-muted-foreground">{device.deviceCode} · Bodycam · {t(`tracking.state.${device.platformState}`)}</span>
                      {blocker ? <span className="block text-xs text-muted-foreground">{t(blocker)}</span> : null}
                    </span>
                    {slot !== -1 ? <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{t('liveWall.list.onScreen', { n: slot + 1 })}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

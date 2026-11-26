import { Video } from 'lucide-react';

import { ToolButton } from '@/components/command-center';
import { DeviceStateBadge } from '@/components/status/DeviceStateBadge';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';
import { usePermission } from '@/lib/usePermission';
import type { WorkOrderCamera } from './workOrders.api';

type WatchableCamera = WorkOrderCamera & { deviceId: string; deviceCode: string };
const isWatchable = (camera: WorkOrderCamera): camera is WatchableCamera =>
  Boolean(camera.deviceId && camera.deviceCode) && camera.platformState === 'online';

/** The job's cameras with their platform state; shared by the list and the detail page. */
export function WorkOrderCameraList({ cameras, detailed = false, onWatch }: {
  cameras: WorkOrderCamera[];
  detailed?: boolean;
  /** Opens the live dialog, which the caller owns so it survives list refreshes; no callback = no ดูสด button. */
  onWatch?: (camera: WorkOrderCamera & { deviceCode: string }, trigger: HTMLElement) => void;
}) {
  const { t } = useLanguage();
  const canWatch = usePermission('streaming:view-live');
  const watch = (camera: WatchableCamera, event: { stopPropagation: () => void; currentTarget: HTMLElement }) => {
    event.stopPropagation();
    onWatch?.(camera, event.currentTarget);
  };
  const watchable = (camera: WorkOrderCamera): camera is WatchableCamera =>
    Boolean(onWatch) && canWatch && isWatchable(camera);
  if (cameras.length === 0) {
    return <span className="text-sm text-muted-foreground">{t('workOrders.noCameras')}</span>;
  }
  if (detailed) {
    return <ul className="divide-y divide-border">
      {cameras.map((camera) => {
        const name = camera.name?.trim();
        const code = camera.deviceCode ?? camera.deviceRef;
        return <li key={camera.deviceRef} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">{name || code}</p>
            {name ? <p className="nwl-mono mt-1 break-all text-xs text-muted-foreground">{code}</p> : null}
          </div>
          {camera.deviceId ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {watchable(camera) ? (
                <Button type="button" variant="outline" size="sm" className="text-xs" aria-haspopup="dialog"
                  aria-label={t('workOrders.camera.watch', { camera: code })}
                  onClick={(event) => watch(camera, event)}>
                  <Video aria-hidden="true" />{t('workOrders.camera.watchShort')}
                </Button>
              ) : null}
              <DeviceStateBadge state={camera.platformState} />
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">{t('workOrders.camera.notFound')}</span>
          )}
        </li>;
      })}
    </ul>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {cameras.map((camera) => (
        <li key={camera.deviceRef} className="flex items-center gap-2 text-sm">
          {camera.deviceId ? (
            <>
              <DeviceStateBadge state={camera.platformState} />
              <span className="nwl-mono text-xs">{camera.deviceCode ?? camera.deviceRef}</span>
              {watchable(camera) ? (
                <ToolButton type="button" tone="view" aria-haspopup="dialog"
                  aria-label={t('workOrders.camera.watch', { camera: camera.deviceCode })}
                  title={t('workOrders.camera.watch', { camera: camera.deviceCode })}
                  onClick={(event) => watch(camera, event)}>
                  <Video aria-hidden="true" />
                </ToolButton>
              ) : null}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              {camera.deviceRef} · {t('workOrders.camera.notFound')}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

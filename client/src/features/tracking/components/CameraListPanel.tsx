import { Search } from 'lucide-react';

import { DeviceStateBadge } from '@/components/status/DeviceStateBadge';
import type { DeviceDisplayState } from '@/components/status/deviceStateTone';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useLanguage } from '@/i18n/useLanguage';
import { cn } from '@/lib/utils';
import type { LiveDevice } from '../liveMerge';

export type StateFilter = 'all' | DeviceDisplayState;

/** Search + status filter + the camera list beside the live map. */
export function CameraListPanel({
  devices,
  total,
  search,
  onSearch,
  state,
  onState,
  selectedId,
  onSelect,
}: {
  devices: readonly LiveDevice[];
  total: number;
  search: string;
  onSearch: (value: string) => void;
  state: StateFilter;
  onState: (value: StateFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_9rem] lg:grid-cols-1 xl:grid-cols-[1fr_9rem]">
        <div className="relative">
          <label htmlFor="tracking-search" className="sr-only">
            {t('tracking.list.search')}
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="tracking-search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t('tracking.list.searchPlaceholder')}
            className="min-h-11 pl-9"
          />
        </div>
        <div>
          <label htmlFor="tracking-state" className="sr-only">
            {t('tracking.list.status')}
          </label>
          <Select id="tracking-state" value={state} onChange={(e) => onState(e.target.value as StateFilter)}>
            <option value="all">{t('tracking.list.all')}</option>
            <option value="online">{t('tracking.state.online')}</option>
            <option value="offline">{t('tracking.state.offline')}</option>
            <option value="unknown">{t('tracking.state.unknown')}</option>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t('tracking.list.count', { shown: devices.length, total })}
      </p>

      {total === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t('tracking.list.empty')}
        </p>
      ) : devices.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t('tracking.list.noMatch')}
        </p>
      ) : (
        <ul aria-label={t('tracking.list.label')} className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {devices.map((device) => (
            <li key={device.id}>
              <button
                type="button"
                onClick={() => onSelect(device.id)}
                aria-current={device.id === selectedId ? 'true' : undefined}
                className={cn(
                  'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  device.id === selectedId && 'bg-muted',
                )}
              >
                <span className="min-w-0">
                  <span className="nwl-mono block truncate text-sm font-medium">{device.deviceCode}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {device.lat === null ? t('tracking.list.noPosition') : (device.name ?? '')}
                  </span>
                </span>
                <DeviceStateBadge state={device.platformState} className="shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

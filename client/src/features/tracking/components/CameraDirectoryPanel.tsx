import { Camera, Menu, Video, Wifi, WifiOff } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { LoadingSkeleton } from '@/components/command-center/LoadingSkeleton';
import { DeviceStateFilter, type DeviceStateFilterValue } from '@/components/status/DeviceStateFilter';
import { DeviceStateBadge } from '@/components/status/DeviceStateBadge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/i18n/useLanguage';
import { normalizedDeviceName } from '@/lib/deviceName';
import { cn } from '@/lib/utils';
import type { LiveDevice } from '../liveMerge';
import { TrackingViewSwitch } from './TrackingViewSwitch';

interface CameraDirectoryPanelProps {
  devices: readonly LiveDevice[];
  total: number;
  counts: Readonly<Record<DeviceStateFilterValue, number>>;
  search: string;
  onSearch: (value: string) => void;
  state: DeviceStateFilterValue;
  onState: (value: DeviceStateFilterValue) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  isPending: boolean;
  unlocatedDetails?: ReactNode;
}

/** Tracking controls followed by an always-visible camera directory. */
export function CameraDirectoryPanel(props: CameraDirectoryPanelProps) {
  const { t } = useLanguage();
  const searchId = useId();
  const summary = [
    { label: t('tracking.summary.total'), value: props.counts.all, icon: Video, tone: 'text-primary' },
    { label: t('tracking.state.online'), value: props.counts.online, icon: Wifi, tone: 'text-success' },
    { label: t('tracking.state.offline'), value: props.counts.offline, icon: WifiOff, tone: 'text-destructive' },
  ];
  return (
    <div aria-busy={props.isPending} className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <div className="flex shrink-0 flex-col gap-3 border-b border-border p-4">
        <div data-slot="directory-heading" className="flex flex-col gap-1.5">
          <h1 className="text-title font-semibold">{t('navigation.tracking')}</h1>
          <p className="text-caption leading-5 text-muted-foreground">{t('tracking.directory.description')}</p>
        </div>
        <TrackingViewSwitch current="live" />
        <dl className="grid grid-cols-3 divide-x divide-border rounded-md border border-border bg-muted/40">
          {summary.map(({ label, value, icon: Icon, tone }) => <div key={label} className="flex min-w-0 flex-col gap-0.5 px-2 py-2">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon aria-hidden="true" className={cn('size-3 shrink-0', tone)} />{label}</dt>
            <dd className="pl-4 text-sm font-semibold tabular-nums">{props.isPending ? '—' : value}</dd>
          </div>)}
        </dl>
        <Field>
          <FieldLabel htmlFor={searchId} className="sr-only">{t('tracking.list.search')}</FieldLabel>
          <Input id={searchId} type="search" value={props.search} onChange={(event) => props.onSearch(event.target.value)}
            disabled={props.isPending} placeholder={t('tracking.list.searchPlaceholder')} />
        </Field>
        <DeviceStateFilter value={props.state} onValueChange={props.onState} disabled={props.isPending} />
      </div>
      <p className="sr-only" aria-live="polite">{t('tracking.list.count', { shown: props.devices.length, total: props.total })}</p>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        {props.isPending ? <LoadingSkeleton loadingLabel={t('common.loading')} /> : props.devices.length === 0 ? (
          <Empty className="px-1 py-8"><EmptyHeader>
            <EmptyMedia variant="icon"><Camera aria-hidden="true" /></EmptyMedia>
            <EmptyDescription>{t(props.total === 0 ? 'tracking.list.empty' : 'tracking.list.noMatch')}</EmptyDescription>
          </EmptyHeader></Empty>
        ) : (
          <div>
          <div className="flex min-h-11 items-center gap-2 text-sm">
            <Menu aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <h2 className="min-w-0 flex-1 truncate font-semibold">{t('tracking.directory.group')}</h2>
            <span className="text-xs tabular-nums text-muted-foreground">{t('liveWall.list.groupCount', { online: props.devices.filter((device) => device.platformState === 'online').length, total: props.devices.length })}</span>
          </div>
          <ul aria-label={t('tracking.list.label')} className="flex flex-col gap-1">
            {props.devices.map((device) => {
              const selected = device.id === props.selectedId;
              return (
                <li key={device.id} className={cn('overflow-hidden rounded-lg border border-transparent bg-card', selected && 'border-primary/50 bg-primary/5 ring-1 ring-primary/15')}>
                  <button type="button" aria-label={t('tracking.card.viewOnMap', { code: device.deviceCode })}
                    aria-pressed={selected} onClick={() => props.onSelect(device.id)}
                    className="flex min-h-[72px] w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <span className="inline-flex size-8 shrink-0 items-center justify-center text-muted-foreground">
                      <Camera aria-hidden="true" className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{normalizedDeviceName(device.name) ?? device.deviceCode}</span>
                        <DeviceStateBadge state={device.platformState} className="h-5 px-1.5" />
                      </span>
                      <span className="block truncate text-xs tabular-nums text-muted-foreground">{t('tracking.card.code', { code: device.deviceCode })} · Bodycam</span>
                    </span>
                  </button>
                  {selected && props.unlocatedDetails ? <div className="p-2">{props.unlocatedDetails}</div> : null}
                </li>
              );
            })}
          </ul>
          </div>
        )}
      </div>
    </div>
  );
}

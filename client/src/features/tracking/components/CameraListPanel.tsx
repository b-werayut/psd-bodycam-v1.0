import { CircleHelp, Video, Wifi, WifiOff } from 'lucide-react';
import { useId } from 'react';

import { LoadingSkeleton } from '@/components/command-center/LoadingSkeleton';
import type { DeviceDisplayState } from '@/components/status/deviceStateTone';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/i18n/useLanguage';
import { cn } from '@/lib/utils';
import type { LiveDevice } from '../liveMerge';
import { CameraCard } from './CameraCard';

export type StateFilter = 'all' | DeviceDisplayState;

/** The reference tracking rail, adapted to the Bodycam data contract. */
export function CameraListPanel({
  devices, allDevices, search, onSearch, state, onState, selectedId, onSelect, onClearSelection,
  now, fixActiveSeconds, isPending = false,
}: {
  devices: readonly LiveDevice[];
  allDevices: readonly LiveDevice[];
  search: string;
  onSearch: (value: string) => void;
  state: StateFilter;
  onState: (value: StateFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
  now: number;
  fixActiveSeconds: number;
  isPending?: boolean;
}) {
  const { t } = useLanguage();
  const searchId = useId();
  const counts = { online: 0, offline: 0, unknown: 0 };
  for (const device of allDevices) counts[device.platformState] += 1;
  const summary = [
    { label: t('tracking.summary.total'), value: allDevices.length, icon: Video, tone: 'text-primary' },
    { label: t('tracking.state.online'), value: counts.online, icon: Wifi, tone: 'text-success' },
    { label: t('tracking.state.offline'), value: counts.offline, icon: WifiOff, tone: 'text-destructive' },
    ...(counts.unknown > 0 ? [{ label: t('tracking.filter.unknown'), value: counts.unknown, icon: CircleHelp, tone: 'text-muted-foreground' }] : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card">
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-border p-4">
        <div>
          <h2 aria-hidden="true" className="text-lg font-semibold tracking-tight">{t('navigation.tracking')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('tracking.live.description')}</p>
        </div>
        <dl className={cn('grid divide-x divide-border rounded-md border border-border bg-muted/40', summary.length > 3 ? 'grid-cols-4' : 'grid-cols-3')}>
          {summary.map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
              <dt className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', tone)} />
                <span className="truncate" title={label}>{label}</span>
              </dt>
              <dd className="pl-5 text-sm font-semibold tabular-nums">{isPending ? '—' : value}</dd>
            </div>
          ))}
        </dl>
        <Field>
          <FieldLabel htmlFor={searchId} className="sr-only">{t('tracking.list.search')}</FieldLabel>
          <Input id={searchId} value={search} onChange={(event) => onSearch(event.target.value)}
            placeholder={t('tracking.list.searchPlaceholder')} disabled={isPending}
            className="bg-card [@media(pointer:fine)]:h-9" />
        </Field>
        <Tabs value={state} onValueChange={(value) => onState(value as StateFilter)}>
          <TabsList aria-label={t('tracking.list.status')} className="grid w-full grid-cols-4 gap-0 overflow-hidden rounded-md border border-border bg-card p-0">
            {([
              ['all', t('tracking.list.all')], ['online', t('tracking.state.online')],
              ['offline', t('tracking.state.offline')], ['unknown', t('tracking.filter.unknown')],
            ] as const).map(([value, label]) => (
              <TabsTrigger key={value} value={value} disabled={isPending}
                className="rounded-none px-2 py-1 text-xs shadow-none data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none [&:not(:last-child)]:border-r [@media(pointer:fine)]:min-h-8">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <p className="sr-only" aria-live="polite">{t('tracking.list.count', { shown: devices.length, total: allDevices.length })}</p>
        {isPending ? (
          <LoadingSkeleton loadingLabel={t('common.loading')} />
        ) : devices.length === 0 ? (
          <Empty className="py-8 md:p-6"><EmptyHeader>
            <EmptyMedia variant="icon"><Video aria-hidden="true" /></EmptyMedia>
            <EmptyDescription>{t(allDevices.length === 0 ? 'tracking.list.empty' : 'tracking.list.noMatch')}</EmptyDescription>
          </EmptyHeader></Empty>
        ) : (
          <ul aria-label={t('tracking.list.label')} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain pr-1">
            {devices.map((device) => (
              <li key={device.id}><CameraCard device={device} now={now} fixActiveSeconds={fixActiveSeconds} selected={device.id === selectedId}
                onSelect={() => onSelect(device.id)} onClose={onClearSelection} /></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

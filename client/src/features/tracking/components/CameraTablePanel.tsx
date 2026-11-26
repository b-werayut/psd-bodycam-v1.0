import { Circle, Copy, Route, Search, Video } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router-dom';

import { DataTableFrame } from '@/components/command-center/DataTableFrame';
import { LoadingSkeleton } from '@/components/command-center/LoadingSkeleton';
import { DeviceStateBadge } from '@/components/status/DeviceStateBadge';
import { DeviceStateFilter, type DeviceStateFilterValue } from '@/components/status/DeviceStateFilter';
import { actionToast } from '@/components/ui/action-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLanguage } from '@/i18n/useLanguage';
import { normalizedDeviceName } from '@/lib/deviceName';
import { usePermission } from '@/lib/usePermission';
import { cn } from '@/lib/utils';
import type { LiveDevice } from '../liveMerge';
import { isStaleFix, positionAge } from '../positionAge';
import { historyViewHref } from '../trackingView';

interface CameraTablePanelProps {
  devices: readonly LiveDevice[];
  total: number;
  search: string;
  onSearch: (value: string) => void;
  state: DeviceStateFilterValue;
  onState: (value: DeviceStateFilterValue) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onWatch: (device: LiveDevice) => void;
  now: number;
  fixActiveSeconds: number;
  isPending: boolean;
}

/** Camera directory and its filters live together below the map. */
export function CameraTablePanel(props: CameraTablePanelProps) {
  const { t } = useLanguage();
  const searchId = useId();
  const titleId = useId();
  const canWatch = usePermission('streaming:view-live');
  const canSeeHistory = usePermission('tracking:history');
  const hasActions = canWatch || canSeeHistory;
  const columns = ['name', 'code', 'status', 'gps', 'position', 'updated'] as const;

  const copyCoordinates = async (coordinates: string) => {
    try {
      await navigator.clipboard.writeText(coordinates);
      actionToast.success(t('tracking.card.copySuccess'));
    } catch {
      actionToast.error(t('tracking.card.copyFailed'));
    }
  };

  return (
    <section aria-labelledby={titleId} aria-busy={props.isPending} className="flex min-w-0 shrink-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 id={titleId} className="text-lg font-semibold">{t('tracking.list.label')}</h2>
          <Badge variant="secondary" className="tabular-nums">{props.isPending ? '—' : t('tracking.table.count', { n: props.devices.length })}</Badge>
        </div>
        <div className="flex w-full flex-col gap-3 sm:flex-row xl:w-auto">
          <Field className="relative min-w-0 flex-1 xl:w-80">
            <FieldLabel htmlFor={searchId} className="sr-only">{t('tracking.list.search')}</FieldLabel>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id={searchId} value={props.search} onChange={(event) => props.onSearch(event.target.value)}
              placeholder={t('tracking.list.searchPlaceholder')} disabled={props.isPending} className="bg-card pl-9" />
          </Field>
          <div className="min-w-0 flex-1 sm:min-w-80">
            <DeviceStateFilter value={props.state} onValueChange={props.onState} disabled={props.isPending} />
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{t('tracking.list.count', { shown: props.devices.length, total: props.total })}</p>
      {props.isPending ? <LoadingSkeleton loadingLabel={t('common.loading')} /> : props.devices.length === 0 ? (
        <Empty className="border border-border bg-card py-8"><EmptyHeader>
          <EmptyMedia variant="icon"><Video aria-hidden="true" /></EmptyMedia>
          <EmptyDescription>{t(props.total === 0 ? 'tracking.list.empty' : 'tracking.list.noMatch')}</EmptyDescription>
        </EmptyHeader></Empty>
      ) : (
        <DataTableFrame label={t('tracking.table.region')}>
          <Table aria-label={t('tracking.list.label')} className="min-w-[1080px]">
            <TableHeader><TableRow>
              {columns.map((column) => <TableHead key={column} className="whitespace-nowrap bg-muted/60">{t(`tracking.table.${column}`)}</TableHead>)}
              {hasActions ? <TableHead className="whitespace-nowrap bg-muted/60">{t('tracking.table.actions')}</TableHead> : null}
            </TableRow></TableHeader>
            <TableBody>
              {props.devices.map((device) => {
                const coordinates = device.lat !== null && device.lng !== null ? `${device.lat.toFixed(5)}, ${device.lng.toFixed(5)}` : null;
                const stale = isStaleFix(device.lastFixAt, props.fixActiveSeconds, props.now);
                const gpsKey = !coordinates ? 'tracking.list.noPosition' : stale ? 'tracking.state.unknown' : 'tracking.state.online';
                const age = device.lastFixAt ? positionAge(device.lastFixAt, props.now) : null;
                const selected = device.id === props.selectedId;
                return (
                  <TableRow key={device.id} aria-label={device.deviceCode} aria-selected={selected}
                    onClick={() => props.onSelect(device.id)}
                    className={cn('group cursor-pointer [&>td]:py-1', selected && 'bg-primary/10 hover:bg-primary/15')}>
                    <TableCell className="w-[20%] py-1.5">
                      <Button type="button" variant="ghost" aria-label={t('tracking.card.viewOnMap', { code: device.deviceCode })}
                        aria-pressed={selected} onClick={(event) => { event.stopPropagation(); props.onSelect(device.id); }}
                        className="max-w-60 justify-start gap-3 px-1 text-left">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Video aria-hidden="true" className="size-4" /></span>
                        <span className="truncate">{normalizedDeviceName(device.name) ?? device.deviceCode}</span>
                      </Button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{device.deviceCode}</TableCell>
                    <TableCell><DeviceStateBadge state={device.platformState} /></TableCell>
                    <TableCell aria-label={t('tracking.card.gps', { status: t(gpsKey) })}>
                      <span className={cn('inline-flex items-center gap-2 whitespace-nowrap text-xs', coordinates && !stale ? 'text-success' : 'text-muted-foreground')}>
                        <Circle aria-hidden="true" className="size-2 fill-current" />{t(gpsKey)}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {coordinates ? <div className="flex items-center gap-1">
                        <span>{coordinates}</span>
                        <Button type="button" variant="ghost" size="icon" aria-label={t('tracking.card.copyCoordinates')}
                          className="size-8 text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
                          onClick={(event) => { event.stopPropagation(); void copyCoordinates(coordinates); }}><Copy aria-hidden="true" /></Button>
                      </div> : <span className="text-muted-foreground">{t('tracking.list.noPosition')}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{age ? t(age.key, { n: age.n }) : '—'}</TableCell>
                    {hasActions ? <TableCell onClick={(event) => event.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        {canWatch ? <Button type="button" size="sm" disabled={device.platformState !== 'online'} onClick={() => props.onWatch(device)}><Video aria-hidden="true" />{t('tracking.card.watch')}</Button> : null}
                        {canSeeHistory ? <Button asChild variant="outline" size="sm"><Link to={historyViewHref(device.id)}><Route aria-hidden="true" />{t('tracking.card.history')}</Link></Button> : null}
                      </div>
                    </TableCell> : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DataTableFrame>
      )}
    </section>
  );
}

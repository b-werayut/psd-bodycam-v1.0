import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLanguage } from '@/i18n/useLanguage';
import type { DeviceDisplayState } from './deviceStateTone';

export type DeviceStateFilterValue = 'all' | DeviceDisplayState;

/** Shared connectivity filter for the map and live camera rail. */
export function DeviceStateFilter({ value, onValueChange, disabled = false }: {
  value: DeviceStateFilterValue;
  onValueChange: (value: DeviceStateFilterValue) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as DeviceStateFilterValue)}>
      <TabsList aria-label={t('tracking.list.status')} className="grid w-full grid-cols-4 gap-0 overflow-hidden rounded-md border border-border bg-card p-0">
        {([
          ['all', t('tracking.list.all')], ['online', t('tracking.state.online')],
          ['offline', t('tracking.state.offline')], ['unknown', t('tracking.filter.unknown')],
        ] as const).map(([state, label]) => (
          <TabsTrigger key={state} value={state} disabled={disabled}
            className="rounded-none px-2 py-1 text-xs shadow-none data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none [&:not(:last-child)]:border-r [@media(pointer:fine)]:min-h-8">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

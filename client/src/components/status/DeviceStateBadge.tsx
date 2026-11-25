import { CircleHelp, Wifi, WifiOff } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/i18n/useLanguage';
import { cn } from '@/lib/utils';
import { deviceStateTone, type DeviceDisplayState } from './deviceStateTone';

const LABEL_KEY = {
  online: 'tracking.state.online',
  offline: 'tracking.state.offline',
  unknown: 'tracking.state.unknown',
} as const;

// Reuse Internal-BodyCam's DeviceOnlineBadge presentation for all camera connectivity badges.
const CONNECTIVITY_PRESENTATION = {
  online: {
    className: 'border-success/30 bg-success/10 text-success',
    icon: Wifi,
  },
  offline: {
    className: 'border-destructive/30 bg-destructive/10 text-destructive',
    icon: WifiOff,
  },
  unknown: {
    className: 'border-border bg-muted text-muted-foreground',
    icon: CircleHelp,
  },
} as const;

export function DeviceStateBadge({ state, className }: { state: DeviceDisplayState; className?: string }) {
  const { t } = useLanguage();
  const presentation = CONNECTIVITY_PRESENTATION[state];
  const Icon = presentation.icon;

  return (
    <Badge
      variant="outline"
      data-connectivity={state}
      data-tone={deviceStateTone(state)}
      className={cn(
        'h-6 shrink-0 gap-1 whitespace-nowrap rounded-md px-2 py-0 text-caption font-medium leading-4 shadow-none',
        presentation.className,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3 shrink-0" />
      {t(LABEL_KEY[state])}
    </Badge>
  );
}

import { StatusBadge } from '@/components/command-center';
import { useLanguage } from '@/i18n/useLanguage';
import { deviceStateTone, type DeviceDisplayState } from './deviceStateTone';

const LABEL_KEY = {
  online: 'tracking.state.online',
  offline: 'tracking.state.offline',
  unknown: 'tracking.state.unknown',
} as const;

export function DeviceStateBadge({ state, className }: { state: DeviceDisplayState; className?: string }) {
  const { t } = useLanguage();
  return (
    <StatusBadge tone={deviceStateTone(state)} className={className}>
      {t(LABEL_KEY[state])}
    </StatusBadge>
  );
}

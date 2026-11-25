import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TalkControl } from '@/features/talk/TalkControl';
import { browserSupportsTalk, TALK_PERMISSION, talkBlockerOf } from '@/features/talk/talkRules';
import { useTalkSession } from '@/features/talk/useTalkSession';
import { useLanguage } from '@/i18n/useLanguage';
import { normalizedDeviceName } from '@/lib/deviceName';
import { usePermission } from '@/lib/usePermission';
import type { LiveTarget } from '../livePlayer';
import type { LiveSession } from '../streaming.api';
import { StreamPlayer } from './StreamPlayer';

/** Live view + two-way talk in a dialog. Closing = unmount, which stops talk and the live stream. */
export function LiveStreamDialog({ device, onClose }: { device: LiveTarget; onClose: () => void }) {
  const { t } = useLanguage();
  const deviceName = normalizedDeviceName(device.deviceName);
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);
  const canTalk = usePermission(TALK_PERMISSION);
  const talk = useTalkSession(liveSession?.sessionToken ?? null);
  const talkBlocker = talkBlockerOf({
    canTalk,
    supported: browserSupportsTalk(window),
    liveReady: liveSession !== null,
  });

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        closeLabel={t('streaming.closeDialog')}
        className="gap-0 overflow-x-hidden overflow-y-auto p-0 sm:w-[calc(100%-2rem)] sm:max-w-[67rem]"
      >
        <DialogHeader className="mb-0 border-b border-border px-4 py-3 pr-14">
          <div data-slot="device-identity" className="min-w-0">
            <DialogTitle data-slot="device-identity-primary" className="truncate text-subheading">
              {deviceName ?? device.deviceCode}
            </DialogTitle>
            <span
              data-slot="device-identity-secondary"
              className="mt-0.5 block truncate text-xs text-muted-foreground"
            >
              {deviceName ? (
                <>
                  {t('streaming.identity.codePrefix')}{' '}
                  <span className="nwl-mono tabular-nums">{device.deviceCode}</span>
                </>
              ) : (
                t('streaming.identity.unnamed')
              )}
            </span>
          </div>
          <DialogDescription className="sr-only">{t('streaming.description')}</DialogDescription>
        </DialogHeader>

        <StreamPlayer
          device={device}
          onSessionChange={setLiveSession}
          forceMuted={talk.state === 'active'}
        />

        <DialogFooter className="border-t border-border px-4 py-3 sm:items-center sm:justify-between">
          {canTalk ? <TalkControl talk={talk} blocker={talkBlocker} /> : <span />}
          <Button variant="outline" onClick={onClose}>
            {t('streaming.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

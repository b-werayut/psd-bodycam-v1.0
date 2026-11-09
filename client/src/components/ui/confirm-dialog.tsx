import { useCallback, useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/i18n/useLanguage';
import { cn } from '@/lib/utils';

export type ConfirmRequest = {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'destructive';
  onConfirm: () => void;
};

export function useConfirm() {
  const { t } = useLanguage();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const ask = useCallback((next: ConfirmRequest) => setRequest(next), []);
  const close = useCallback(() => setRequest(null), []);

  const destructive = request?.tone === 'destructive';

  const dialog = (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent closeLabel={t('common.close')} className="sm:max-w-md">
        <DialogHeader className="flex-row items-start gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg',
              destructive ? 'bg-destructive/10 text-destructive' : 'bg-accent text-accent-foreground',
            )}
          >
            <TriangleAlert size={20} strokeWidth={1.5} />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <DialogTitle>{request?.title ?? ''}</DialogTitle>
            {request?.description ? (
              <DialogDescription>{request.description}</DialogDescription>
            ) : null}
          </span>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={close} autoFocus className="min-h-11">
            {request?.cancelLabel ?? t('common.cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            className="min-h-11"
            onClick={() => {
              request?.onConfirm();
              close();
            }}
          >
            {request?.confirmLabel ?? t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { ask, dialog };
}

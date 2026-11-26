import { Download } from 'lucide-react';

import { Can } from '@/components/Can';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/useLanguage';
import { formatFileSize } from '../evidenceDownload';
import type { useEvidenceDownload } from '../useEvidenceDownload';

export function EvidenceDownloadStatus({ download, blocked, onRequest }: {
  download: ReturnType<typeof useEvidenceDownload>;
  blocked: boolean;
  onRequest: () => void;
}) {
  const { t } = useLanguage();
  const fileSize = formatFileSize(download.view?.fileSizeBytes ?? null);

  if (!download.requesting && download.state === 'idle') return null;

  return (
    <section aria-labelledby="evidence-download-title" className="mt-3 flex min-w-0 flex-col gap-2">
      <h3 id="evidence-download-title" className="text-control font-semibold">{t('evidence.download.title')}</h3>
      <div aria-live="polite" className="min-w-0 text-control">
        {download.requesting ? (
          <p>{t('evidence.download.requesting')}</p>
        ) : null}
        {download.state === 'queued' ? <p>{t('evidence.download.queued')}</p> : null}
        {download.state === 'processing' ? (
          <div className="flex flex-col gap-2">
            <p>{t('evidence.download.processing', { n: download.progress })}</p>
            <div role="progressbar" aria-label={t('evidence.download.title')}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={download.progress}
              className="h-2 overflow-hidden rounded-full bg-border">
              <div className="h-full bg-primary" style={{ width: `${download.progress}%` }} />
            </div>
          </div>
        ) : null}
        {download.state === 'ready' ? (
          <div className="flex min-w-0 flex-col items-start gap-2">
            <p className="font-medium">{t('evidence.download.ready')}</p>
            <Can permission="evidence:download"
              fallback={<p className="text-muted-foreground">{t('evidence.download.noPermission')}</p>}>
              <Button type="button" size="sm" className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-left"
                onClick={download.download} disabled={download.downloading}>
                <Download aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 break-all">
                  {t('evidence.download.file', { name: download.view?.fileName ?? 'MP4' })}
                  {fileSize ? ` (${fileSize})` : ''}
                </span>
              </Button>
            </Can>
          </div>
        ) : null}
        {download.state === 'failed' ? (
          <div className="flex flex-col items-start gap-2">
            <p className="font-medium text-destructive">{t('evidence.download.failed')}</p>
            {download.error ? <p className="break-words">{download.error}</p> : null}
            <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={onRequest} disabled={blocked}>
              {t('evidence.download.retry')}
            </Button>
          </div>
        ) : null}
        {download.state === 'expired' ? (
          <div className="flex flex-col items-start gap-2">
            <p className="font-medium">{t('evidence.download.expired')}</p>
            <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={onRequest} disabled={blocked}>
              {t('evidence.download.again')}
            </Button>
          </div>
        ) : null}
        {download.state === 'ready' && download.error ? (
          <p role="alert" className="mt-2 break-words text-destructive">{download.error}</p>
        ) : null}
      </div>
    </section>
  );
}

import { EVIDENCE_EXPORT_STATUS } from './evidenceExports.api';

export type DownloadState = 'idle' | 'queued' | 'processing' | 'ready' | 'failed' | 'expired';

const STATE_BY_STATUS: Record<number, DownloadState> = {
  [EVIDENCE_EXPORT_STATUS.QUEUED]: 'queued',
  [EVIDENCE_EXPORT_STATUS.PROCESSING]: 'processing',
  [EVIDENCE_EXPORT_STATUS.READY]: 'ready',
  [EVIDENCE_EXPORT_STATUS.FAILED]: 'failed',
  [EVIDENCE_EXPORT_STATUS.EXPIRED]: 'expired',
};

/** An unknown status (added by the server later) counts as still waiting, never as done. */
export function stateOfStatus(status: number): DownloadState {
  return STATE_BY_STATUS[status] ?? 'queued';
}

export const isPending = (state: DownloadState): boolean => state === 'queued' || state === 'processing';

/** Human file size from the server's `fileSizeBytes` string. */
export function formatFileSize(bytes: string | null): string | null {
  if (bytes === null) return null;
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * The link to open for a ticket `url` (a server path such as `/api/...`). When the API base is an absolute URL the path
 * is resolved against that origin; otherwise it is used as is.
 */
export function resolveDownloadUrl(url: string, apiBase: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (/^https?:\/\//i.test(apiBase)) return new URL(url, apiBase).toString();
  return url;
}

/** Let the browser download the file itself through the ticket link: GB files must not be loaded as a blob. */
export function triggerBrowserDownload(url: string, fileName: string, doc: Document = document): void {
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

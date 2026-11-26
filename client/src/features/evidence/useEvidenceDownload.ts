import { AxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useLanguage } from '@/i18n/useLanguage';
import { API_BASE } from '@/lib/apiClient';
import { backendMessage } from '@/lib/apiError';
import {
  isPending,
  resolveDownloadUrl,
  stateOfStatus,
  triggerBrowserDownload,
  type DownloadState,
} from './evidenceDownload';
import {
  evidenceExportsApi,
  type EvidenceExportRequest,
  type EvidenceExportView,
} from './evidenceExports.api';

export const POLL_MS = 2000;

const errorCode = (e: unknown): string | null =>
  e instanceof AxiosError
    ? (((e.response?.data as { code?: unknown } | undefined)?.code as string | undefined) ?? null)
    : null;
const errorStatus = (e: unknown): number | null => (e instanceof AxiosError ? (e.response?.status ?? null) : null);

/**
 * Request an MP4 export, poll its status every 2 s (one request at a time) until it is ready / failed / expired,
 * then download through a short-lived ticket link. Asking again for the same range returns the same server row.
 */
export function useEvidenceDownload() {
  const { t } = useLanguage();
  const [view, setView] = useState<EvidenceExportView | null>(null);
  const [state, setState] = useState<DownloadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  /** bumped after every poll answer, so the effect schedules the next poll */
  const [tick, setTick] = useState(0);
  /** a new request / reset / unmount invalidates every answer still in flight */
  const epoch = useRef(0);

  const apply = useCallback((next: EvidenceExportView) => {
    setView(next);
    setState(stateOfStatus(next.status));
    setError(next.status === 4 ? next.errorMessage : null);
  }, []);

  const exportId = view?.id ?? null;
  useEffect(() => {
    if (exportId === null || !isPending(state)) return;
    const mine = epoch.current;
    const timer = window.setTimeout(() => {
      evidenceExportsApi
        .get(exportId)
        .then((next) => {
          if (epoch.current !== mine) return;
          apply(next);
          setTick((n) => n + 1);
        })
        .catch((e: unknown) => {
          if (epoch.current !== mine) return;
          if (errorStatus(e) === 404) {
            setState('expired');
            return;
          }
          // a failed poll (network blip) is not the end: try again
          setTick((n) => n + 1);
        });
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [exportId, state, tick, apply]);

  useEffect(
    () => () => {
      epoch.current += 1;
    },
    [],
  );

  const reset = useCallback(() => {
    epoch.current += 1;
    setView(null);
    setState('idle');
    setError(null);
    setRequesting(false);
    setDownloading(false);
  }, []);

  const request = useCallback(
    (range: EvidenceExportRequest) => {
      epoch.current += 1;
      const mine = epoch.current;
      setError(null);
      setView(null);
      setState('idle');
      setRequesting(true);
      evidenceExportsApi
        .request(range)
        .then((next) => {
          if (epoch.current === mine) apply(next);
        })
        .catch((e: unknown) => {
          if (epoch.current !== mine) return;
          setError(backendMessage(e) ?? t('evidence.download.requestFailed'));
          setState('failed');
        })
        .finally(() => {
          if (epoch.current === mine) setRequesting(false);
        });
    },
    [apply, t],
  );

  const download = useCallback(() => {
    if (!view) return;
    const mine = epoch.current;
    setDownloading(true);
    setError(null);
    evidenceExportsApi
      .ticket(view.id)
      .then((ticket) => {
        if (epoch.current !== mine) return;
        triggerBrowserDownload(resolveDownloadUrl(ticket.url, API_BASE), ticket.fileName);
      })
      .catch((e: unknown) => {
        if (epoch.current !== mine) return;
        const code = errorCode(e);
        if (errorStatus(e) === 404 && (code === 'EXPORT_EXPIRED' || code === 'EXPORT_NOT_FOUND')) {
          setState('expired');
        } else if (code === 'EXPORT_NOT_READY') {
          setState('processing');
        } else {
          setError(backendMessage(e) ?? t('evidence.download.ticketFailed'));
        }
      })
      .finally(() => {
        if (epoch.current === mine) setDownloading(false);
      });
  }, [view, t]);

  return {
    state,
    progress: state === 'ready' ? 100 : Math.max(0, Math.min(100, view?.progress ?? 0)),
    view,
    error,
    requesting,
    downloading,
    request,
    download,
    reset,
  };
}

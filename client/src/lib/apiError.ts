import { AxiosError } from 'axios';

import type { Translate } from '@/i18n/LanguageProvider';

export type ApiErrorInfo = {
  status: number | null;
  code: string | null;
  message: string;
  correlationId: string | null;
  /** The body's `details` as sent (shape depends on `code`), or null when absent. */
  details: unknown;
  isNetwork: boolean;
};

type ErrorBody = { code?: unknown; message?: unknown; correlationId?: unknown; details?: unknown };

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function apiErrorOf(error: unknown, t: Translate): ApiErrorInfo {
  if (!(error instanceof AxiosError)) {
    return {
      status: null,
      code: null,
      message: t('common.error.generic'),
      correlationId: null,
      details: null,
      isNetwork: false,
    };
  }
  const isNetwork = !error.response;
  const raw = error.response?.data;
  const body: ErrorBody = raw && typeof raw === 'object' ? (raw as ErrorBody) : {};
  const rawMessage = Array.isArray(body.message)
    ? body.message.filter((m) => typeof m === 'string').join(' · ')
    : body.message;
  return {
    status: error.response?.status ?? null,
    code: str(body.code),
    message: str(rawMessage) ?? (isNetwork ? t('common.error.network') : t('common.error.generic')),
    correlationId: str(body.correlationId),
    details: body.details ?? null,
    isNetwork,
  };
}

/** A 4xx answer: the request itself was refused, so repeating it gives the same result. */
export function isClientError(error: unknown): boolean {
  const status = error instanceof AxiosError ? error.response?.status : undefined;
  return status !== undefined && status >= 400 && status < 500;
}

/** The backend's own (Thai) `message`, or null when the error carries none (network, non-API). */
export function backendMessage(error: unknown): string | null {
  if (!(error instanceof AxiosError)) return null;
  const message = (error.response?.data as { message?: unknown } | undefined)?.message;
  if (Array.isArray(message)) {
    const parts = message.filter((m): m is string => typeof m === 'string');
    return parts.length ? parts.join(' · ') : null;
  }
  return typeof message === 'string' && message !== '' ? message : null;
}

import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthUserLike } from '../auth/auth-user';

export interface RequestContext {
  correlationId: string;
  userId?: bigint;
  user?: AuthUserLike;
  ip?: string;
  userAgent?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export const getContext = (): RequestContext | undefined => requestContext.getStore();

export const getUserId = (): bigint | undefined => requestContext.getStore()?.userId;

export const getCurrentUser = (): AuthUserLike | undefined => requestContext.getStore()?.user;

export const getCorrelationId = (): string | undefined => requestContext.getStore()?.correlationId;

const VALID_CORRELATION_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Single derivation of the correlation id: reuse req.id, else a valid header, else a new uuid. */
export function resolveCorrelationId(req: {
  headers: Record<string, string | string[] | undefined>;
  id?: unknown;
}): string {
  if (typeof req.id === 'string' && req.id) return req.id;
  const incoming = req.headers['x-correlation-id'];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  return candidate && VALID_CORRELATION_ID.test(candidate) ? candidate : randomUUID();
}

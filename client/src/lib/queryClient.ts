import { QueryClient } from '@tanstack/react-query';

import { isClientError } from './apiError';

/** 4xx never changes on retry (403, 404, 409, …). Network errors and 5xx get up to two retries. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return !isClientError(error) && failureCount < 2;
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: shouldRetryQuery } },
});

export function resetQueryCache(): void {
  void queryClient.cancelQueries();
  queryClient.clear();
}

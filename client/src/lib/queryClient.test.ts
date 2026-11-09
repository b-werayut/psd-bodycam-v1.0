import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import { queryClient, shouldRetryQuery } from './queryClient';

function axiosError(status: number) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('fail', 'ERR', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data: {},
  });
}
const networkError = () => new AxiosError('Network Error', 'ERR_NETWORK');

describe('query retry policy', () => {
  it('never retries a 4xx: the answer will not change', () => {
    for (const status of [400, 401, 403, 404, 409, 412]) {
      expect(shouldRetryQuery(0, axiosError(status)), String(status)).toBe(false);
    }
  });

  it('retries network errors and 5xx at most twice', () => {
    for (const error of [networkError(), axiosError(500), axiosError(503), new Error('x')]) {
      expect(shouldRetryQuery(0, error)).toBe(true);
      expect(shouldRetryQuery(1, error)).toBe(true);
      expect(shouldRetryQuery(2, error)).toBe(false);
    }
  });

  it('is the app query client default', () => {
    expect(queryClient.getDefaultOptions().queries?.retry).toBeTypeOf('function');
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(shouldRetryQuery);
  });
});

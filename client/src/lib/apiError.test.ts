import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import { th } from '@/i18n/locales/th';
import { translate } from '@/i18n/translate';
import type { Translate } from '@/i18n/LanguageProvider';
import { apiErrorOf, isClientError } from './apiError';

const t: Translate = (key, params) => translate('th', key, params);

function axiosError(status: number, data: unknown) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('fail', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  });
}
const networkError = () => new AxiosError('Network Error', 'ERR_NETWORK');

describe('apiErrorOf', () => {
  it('uses the backend body', () => {
    expect(
      apiErrorOf(
        axiosError(409, {
          statusCode: 409,
          code: 'USERNAME_TAKEN',
          message: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว',
          correlationId: 'c1',
        }),
        t,
      ),
    ).toEqual({
      status: 409,
      code: 'USERNAME_TAKEN',
      message: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว',
      correlationId: 'c1',
      details: null,
      isNetwork: false,
    });
  });
  it('carries details from the body', () => {
    const info = apiErrorOf(
      axiosError(409, {
        statusCode: 409,
        code: 'DEPARTMENT_IN_USE',
        message: 'ลบไม่ได้',
        details: { children: 1, employees: 3 },
      }),
      t,
    );
    expect(info.details).toEqual({ children: 1, employees: 3 });
  });
  it('network error gives the network message', () => {
    const info = apiErrorOf(networkError(), t);
    expect(info.message).toBe(th['common.error.network']);
    expect(info.isNetwork).toBe(true);
    expect(info.status).toBeNull();
  });
  it('non-JSON body gives the generic message', () => {
    expect(apiErrorOf(axiosError(500, '<html>'), t).message).toBe(th['common.error.generic']);
  });
  it('non-axios error gives the generic message', () => {
    expect(apiErrorOf(new Error('x'), t).message).toBe(th['common.error.generic']);
  });
});

describe('isClientError', () => {
  it('is true only for a 4xx response', () => {
    expect(isClientError(axiosError(400, {}))).toBe(true);
    expect(isClientError(axiosError(403, {}))).toBe(true);
    expect(isClientError(axiosError(499, {}))).toBe(true);
    expect(isClientError(axiosError(500, {}))).toBe(false);
    expect(isClientError(axiosError(503, {}))).toBe(false);
    expect(isClientError(networkError())).toBe(false);
    expect(isClientError(new Error('x'))).toBe(false);
  });
});

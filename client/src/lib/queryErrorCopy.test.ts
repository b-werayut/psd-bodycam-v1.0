import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import { th } from '@/i18n/locales/th';
import { translate } from '@/i18n/translate';
import type { Translate } from '@/i18n/LanguageProvider';
import { queryErrorDescription } from './queryErrorCopy';

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

describe('queryErrorDescription', () => {
  it('shows the backend message of a 4xx as-is', () => {
    const error = axiosError(403, {
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'คุณไม่มีสิทธิ์ดูรายชื่อผู้ใช้',
      correlationId: 'c9',
    });
    expect(queryErrorDescription(error, t)).toBe('คุณไม่มีสิทธิ์ดูรายชื่อผู้ใช้');
  });

  it('shows the backend message of a 5xx when there is one', () => {
    expect(queryErrorDescription(axiosError(500, { message: 'ฐานข้อมูลไม่ตอบสนอง' }), t)).toBe(
      'ฐานข้อมูลไม่ตอบสนอง',
    );
  });

  it('asks to check the connection only when there was no response', () => {
    expect(queryErrorDescription(new AxiosError('Network Error', 'ERR_NETWORK'), t)).toBe(
      th['common.checkConnection'],
    );
  });

  it('falls back to the generic message for a response without a message, or a non-API error', () => {
    expect(queryErrorDescription(axiosError(502, '<html>'), t)).toBe(th['common.error.generic']);
    expect(queryErrorDescription(new TypeError('boom'), t)).toBe(th['common.error.generic']);
  });
});

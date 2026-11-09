import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import { translate } from '@/i18n/translate';
import type { Translate } from '@/i18n/LanguageProvider';
import { apiErrorOf } from '@/lib/apiError';
import { departmentInUseDetails } from './departments.api';

const t: Translate = (key, params) => translate('th', key, params);

function info(status: number, data: unknown) {
  const config = { headers: new AxiosHeaders() };
  return apiErrorOf(
    new AxiosError('fail', 'ERR', config, null, { status, statusText: '', headers: {}, config, data }),
    t,
  );
}

describe('departmentInUseDetails', () => {
  it('reads the counts from ApiErrorInfo.details of a 409 DEPARTMENT_IN_USE', () => {
    expect(
      departmentInUseDetails(
        info(409, { code: 'DEPARTMENT_IN_USE', message: 'x', details: { children: 2, employees: 5 } }),
      ),
    ).toEqual({ children: 2, employees: 5 });
  });

  it('treats missing counts as zero', () => {
    expect(departmentInUseDetails(info(409, { code: 'DEPARTMENT_IN_USE', message: 'x' }))).toEqual({
      children: 0,
      employees: 0,
    });
  });

  it('is null for any other error', () => {
    expect(departmentInUseDetails(info(409, { code: 'DEPARTMENT_CODE_TAKEN' }))).toBeNull();
    expect(departmentInUseDetails(info(400, { code: 'DEPARTMENT_IN_USE' }))).toBeNull();
    expect(departmentInUseDetails(apiErrorOf(new Error('x'), t))).toBeNull();
  });
});

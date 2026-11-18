import { describe, expect, it } from 'vitest';

import {
  emptyEmployeeForm,
  employeeFormFrom,
  toCreatePayload,
  toUpdatePayload,
  validateEmployeeForm,
} from './employeeForm';
import type { EmployeeRow } from './employees.api';

const row: EmployeeRow = {
  id: '9',
  employeeCode: 'E001',
  firstName: 'สมชาย',
  lastName: 'ใจดี',
  phone: null,
  userId: null,
  bookingEmployeeRef: null,
  status: 1,
};

describe('validateEmployeeForm', () => {
  it('requires code and names only', () => {
    expect(validateEmployeeForm(emptyEmployeeForm())).toEqual({
      employeeCode: 'employees.form.errorCodeRequired',
      firstName: 'employees.form.errorFirstNameRequired',
      lastName: 'employees.form.errorLastNameRequired',
    });
    expect(
      validateEmployeeForm({ ...emptyEmployeeForm(), employeeCode: 'E1', firstName: 'ก', lastName: 'ข' }),
    ).toEqual({});
  });
  it('limits code length', () => {
    const v = { ...emptyEmployeeForm(), employeeCode: 'x'.repeat(21) };
    expect(validateEmployeeForm(v).employeeCode).toBe('employees.form.errorCodeLong');
  });
});

describe('payloads', () => {
  it('omits empty optionals on create', () => {
    expect(
      toCreatePayload({
        ...emptyEmployeeForm(),
        employeeCode: ' E1 ',
        firstName: 'ก',
        lastName: 'ข',
      }),
    ).toEqual({ employeeCode: 'E1', firstName: 'ก', lastName: 'ข' });
  });
  it('includes optionals when filled', () => {
    expect(
      toCreatePayload({
        ...emptyEmployeeForm(),
        employeeCode: 'E1',
        firstName: 'ก',
        lastName: 'ข',
        phone: '081',
        userId: '7',
        bookingEmployeeRef: 'B-1',
      }),
    ).toMatchObject({ phone: '081', userId: '7', bookingEmployeeRef: 'B-1' });
  });
  it('diffs on update; cleared optionals become null', () => {
    const original = employeeFormFrom({ ...row, phone: '081', userId: '7' });
    expect(toUpdatePayload({ ...original }, original)).toEqual({});
    expect(
      toUpdatePayload({ ...original, phone: '', userId: '', status: '3', firstName: 'ใหม่' }, original),
    ).toEqual({ phone: null, userId: null, status: 3, firstName: 'ใหม่' });
  });
});

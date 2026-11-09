import type { TranslationKey } from '@/i18n/locales/th';
import type {
  CreateEmployeePayload,
  EmployeeRow,
  UpdateEmployeePayload,
} from './employees.api';
import { EMPLOYEE_STATUS } from './employees.api';

export const EMPLOYEE_CODE_MAX = 20;

export type EmployeeFormValues = {
  employeeCode: string;
  firstName: string;
  lastName: string;
  phone: string;
  departmentId: string;
  userId: string;
  bookingEmployeeRef: string;
  status: string;
};

export type EmployeeFormErrors = Partial<Record<keyof EmployeeFormValues, TranslationKey>>;

export function emptyEmployeeForm(): EmployeeFormValues {
  return {
    employeeCode: '',
    firstName: '',
    lastName: '',
    phone: '',
    departmentId: '',
    userId: '',
    bookingEmployeeRef: '',
    status: String(EMPLOYEE_STATUS.ACTIVE),
  };
}

export function employeeFormFrom(employee: EmployeeRow): EmployeeFormValues {
  return {
    employeeCode: employee.employeeCode,
    firstName: employee.firstName,
    lastName: employee.lastName,
    phone: employee.phone ?? '',
    departmentId: employee.departmentId,
    userId: employee.userId ?? '',
    bookingEmployeeRef: employee.bookingEmployeeRef ?? '',
    status: String(employee.status),
  };
}

export function validateEmployeeForm(values: EmployeeFormValues): EmployeeFormErrors {
  const errors: EmployeeFormErrors = {};
  const code = values.employeeCode.trim();
  if (!code) errors.employeeCode = 'employees.form.errorCodeRequired';
  else if (code.length > EMPLOYEE_CODE_MAX) errors.employeeCode = 'employees.form.errorCodeLong';
  if (!values.firstName.trim()) errors.firstName = 'employees.form.errorFirstNameRequired';
  if (!values.lastName.trim()) errors.lastName = 'employees.form.errorLastNameRequired';
  if (!values.departmentId) errors.departmentId = 'employees.form.errorDepartmentRequired';
  return errors;
}

const text = (raw: string): string | undefined => raw.trim() || undefined;

export function toCreatePayload(values: EmployeeFormValues): CreateEmployeePayload {
  return {
    employeeCode: values.employeeCode.trim(),
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    departmentId: values.departmentId,
    ...(text(values.phone) ? { phone: text(values.phone) } : {}),
    ...(values.userId ? { userId: values.userId } : {}),
    ...(text(values.bookingEmployeeRef)
      ? { bookingEmployeeRef: text(values.bookingEmployeeRef) }
      : {}),
  };
}

export function toUpdatePayload(
  values: EmployeeFormValues,
  original: EmployeeFormValues,
): UpdateEmployeePayload {
  const payload: UpdateEmployeePayload = {};
  const required = ['employeeCode', 'firstName', 'lastName'] as const;
  for (const field of required) {
    if (values[field].trim() !== original[field].trim()) payload[field] = values[field].trim();
  }
  if (values.departmentId !== original.departmentId) payload.departmentId = values.departmentId;
  if (values.phone.trim() !== original.phone.trim()) payload.phone = text(values.phone) ?? null;
  if (values.userId !== original.userId) payload.userId = values.userId || null;
  if (values.bookingEmployeeRef.trim() !== original.bookingEmployeeRef.trim()) {
    payload.bookingEmployeeRef = text(values.bookingEmployeeRef) ?? null;
  }
  if (values.status !== original.status) payload.status = Number(values.status);
  return payload;
}

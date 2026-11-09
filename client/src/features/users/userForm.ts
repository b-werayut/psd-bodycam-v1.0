import type { TranslationKey } from '@/i18n/locales/th';
import type { CreateUserPayload, UpdateUserPayload, UserRow } from './users.api';

export const USERNAME_MAX = 50;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type UserFormValues = {
  username: string;
  fullName: string;
  email: string;
  password: string;
  roleCode: string;
  departmentId: string;
};

export type UserFormErrors = Partial<Record<keyof UserFormValues, TranslationKey>>;

export function emptyUserForm(): UserFormValues {
  return { username: '', fullName: '', email: '', password: '', roleCode: '', departmentId: '' };
}

export function userFormFrom(user: UserRow): UserFormValues {
  return {
    username: user.username,
    fullName: user.fullName,
    email: user.email ?? '',
    password: '',
    roleCode: user.roleCode,
    departmentId: user.departmentId ?? '',
  };
}

export function validateUserForm(values: UserFormValues): UserFormErrors {
  const errors: UserFormErrors = {};
  const username = values.username.trim();
  if (!username) errors.username = 'users.form.errorUsernameRequired';
  else if (username.length > USERNAME_MAX) errors.username = 'users.form.errorUsernameLong';

  if (!values.fullName.trim()) errors.fullName = 'users.form.errorFullNameRequired';

  if (!values.roleCode) errors.roleCode = 'users.form.errorRoleRequired';
  else if (values.roleCode !== 'ADMIN' && !values.departmentId) {
    errors.departmentId = 'users.form.errorDepartmentRequired';
  }

  const email = values.email.trim();
  if (email && !EMAIL_RE.test(email)) errors.email = 'users.form.errorEmail';
  return errors;
}

export function toCreatePayload(values: UserFormValues): CreateUserPayload {
  const email = values.email.trim();
  return {
    username: values.username.trim().toLowerCase(),
    fullName: values.fullName.trim(),
    roleCode: values.roleCode,
    ...(email ? { email } : {}),
    ...(values.password ? { password: values.password } : {}),
    ...(values.departmentId ? { departmentId: values.departmentId } : {}),
  };
}

export function toUpdatePayload(
  values: UserFormValues,
  original: UserFormValues,
): UpdateUserPayload {
  const payload: UpdateUserPayload = {};
  if (values.fullName.trim() !== original.fullName.trim()) payload.fullName = values.fullName.trim();
  if (values.roleCode !== original.roleCode) payload.roleCode = values.roleCode;
  if (values.password) payload.password = values.password;
  if (values.email.trim() !== original.email.trim()) payload.email = values.email.trim() || null;
  if (values.departmentId !== original.departmentId) {
    payload.departmentId = values.departmentId || null;
  }
  return payload;
}

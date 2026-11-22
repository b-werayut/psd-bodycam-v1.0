import type { TranslationKey } from '@/i18n/locales/th';
import type { CreateUserPayload, UpdateUserPayload, UserRow } from './users.api';

export const USERNAME_MAX = 50;
/** The server takes usernames of 3–50 characters. */
const ENTRA_USERNAME_MIN = 3;
const FULL_NAME_MAX = 150;
const EMAIL_MAX = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type UserFormValues = {
  username: string;
  fullName: string;
  email: string;
  password: string;
  roleCode: string;
  /** Set only for an account created from an Entra row (SSO-only, no password). */
  azureObjectId?: string;
};

export type UserFormErrors = Partial<Record<keyof UserFormValues, TranslationKey>>;

export function emptyUserForm(): UserFormValues {
  return { username: '', fullName: '', email: '', password: '', roleCode: '' };
}

export function userFormFrom(user: UserRow): UserFormValues {
  return {
    username: user.username,
    fullName: user.fullName,
    email: user.email ?? '',
    password: '',
    roleCode: user.roleCode,
  };
}

export type EntraPrefillSource = {
  upn: string;
  displayName: string | null;
  mail: string | null;
  oid?: string | null;
};

/**
 * Create-form values from an Entra row: username = the UPN part before @ (what the server's
 * username matching compares), email = the UPN (what the sync matches on). Role is never guessed.
 */
export function userFormFromEntra(source: EntraPrefillSource): UserFormValues {
  const upn = source.upn.trim();
  const at = upn.indexOf('@');
  const localPart = at >= 0 ? upn.slice(0, at) : upn;
  const username = localPart
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, USERNAME_MAX);
  const email =
    [upn, source.mail?.trim() ?? ''].find(
      (value) => value.length <= EMAIL_MAX && EMAIL_RE.test(value),
    ) ?? '';
  const oid = source.oid?.trim();
  return {
    ...emptyUserForm(),
    username: username.length >= ENTRA_USERNAME_MIN ? username : '',
    fullName: (source.displayName?.trim() || localPart).slice(0, FULL_NAME_MAX),
    email,
    ...(oid ? { azureObjectId: oid } : {}),
  };
}

export function validateUserForm(values: UserFormValues): UserFormErrors {
  const errors: UserFormErrors = {};
  const username = values.username.trim();
  if (!username) errors.username = 'users.form.errorUsernameRequired';
  else if (username.length > USERNAME_MAX) errors.username = 'users.form.errorUsernameLong';

  if (!values.fullName.trim()) errors.fullName = 'users.form.errorFullNameRequired';

  if (!values.roleCode) errors.roleCode = 'users.form.errorRoleRequired';

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
    ...(values.azureObjectId ? { azureObjectId: values.azureObjectId } : {}),
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
  return payload;
}

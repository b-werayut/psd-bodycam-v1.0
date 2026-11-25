import type { TranslationKey } from '@/i18n/locales/th';
import type { CreateUserPayload, UpdateUserPayload, UserRow } from './users.api';

export const USERNAME_MAX = 50;
/** The server takes usernames of 3–50 characters. */
const ENTRA_USERNAME_MIN = 3;
export const NAME_MAX = 200;
export const PHONE_MAX = 30;
const EMAIL_MAX = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type UserFormValues = {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  roleCode: string;
  /** Set only for an account created from an Entra row (SSO-only, no password). */
  azureObjectId?: string;
};

export type UserFormErrors = Partial<Record<keyof UserFormValues, TranslationKey>>;

export function emptyUserForm(): UserFormValues {
  return { username: '', firstName: '', lastName: '', email: '', phone: '', password: '', roleCode: '' };
}

export function userFormFrom(user: UserRow): UserFormValues {
  return {
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email ?? '',
    phone: user.phone ?? '',
    password: '',
    roleCode: user.roleCode,
  };
}

export type EntraPrefillSource = {
  upn: string;
  displayName: string | null;
  givenName?: string | null;
  surname?: string | null;
  mobilePhone?: string | null;
  businessPhones?: string[];
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
  const [fallbackFirstName, ...rest] = (source.displayName?.trim() || localPart).split(/\s+/);
  const givenName = source.givenName?.trim();
  const surname = source.surname?.trim();
  const structured = Boolean(givenName || surname);
  return {
    ...emptyUserForm(),
    username: username.length >= ENTRA_USERNAME_MIN ? username : '',
    firstName: (structured ? givenName || localPart : fallbackFirstName).slice(0, NAME_MAX),
    lastName: (structured ? surname || '' : rest.join(' ')).slice(0, NAME_MAX),
    email,
    phone: [source.mobilePhone, ...(source.businessPhones ?? [])]
      .map((value) => value?.trim() ?? '')
      .find((value) => value.length > 0 && value.length <= PHONE_MAX) ?? '',
    ...(oid ? { azureObjectId: oid } : {}),
  };
}

export function validateUserForm(values: UserFormValues): UserFormErrors {
  const errors: UserFormErrors = {};
  const username = values.username.trim();
  if (!username) errors.username = 'users.form.errorUsernameRequired';
  else if (username.length > USERNAME_MAX) errors.username = 'users.form.errorUsernameLong';

  if (!values.firstName.trim()) errors.firstName = 'users.form.errorFirstNameRequired';
  else if (values.firstName.trim().length > NAME_MAX) errors.firstName = 'users.form.errorNameLong';
  if (values.lastName.trim().length > NAME_MAX) errors.lastName = 'users.form.errorNameLong';
  if (values.phone.trim().length > PHONE_MAX) errors.phone = 'users.form.errorPhoneLong';

  if (!values.roleCode) errors.roleCode = 'users.form.errorRoleRequired';

  const email = values.email.trim();
  if (email && !EMAIL_RE.test(email)) errors.email = 'users.form.errorEmail';
  return errors;
}

export function toCreatePayload(values: UserFormValues): CreateUserPayload {
  const email = values.email.trim();
  const phone = values.phone.trim();
  return {
    username: values.username.trim().toLowerCase(),
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    roleCode: values.roleCode,
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(values.password ? { password: values.password } : {}),
    ...(values.azureObjectId ? { azureObjectId: values.azureObjectId } : {}),
  };
}

export function toUpdatePayload(
  values: UserFormValues,
  original: UserFormValues,
): UpdateUserPayload {
  const payload: UpdateUserPayload = {};
  const username = values.username.trim().toLowerCase();
  if (username !== original.username.trim().toLowerCase()) payload.username = username;
  if (values.firstName.trim() !== original.firstName.trim()) payload.firstName = values.firstName.trim();
  if (values.lastName.trim() !== original.lastName.trim()) payload.lastName = values.lastName.trim();
  if (values.roleCode !== original.roleCode) payload.roleCode = values.roleCode;
  if (values.password) payload.password = values.password;
  if (values.email.trim() !== original.email.trim()) payload.email = values.email.trim() || null;
  if (values.phone.trim() !== original.phone.trim()) payload.phone = values.phone.trim() || null;
  return payload;
}

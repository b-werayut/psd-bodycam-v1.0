import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, TriangleAlert } from 'lucide-react';

import { actionToast } from '@/components/ui/action-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField, FormRequirementNote } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Select } from '@/components/ui/select';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import { useAuthStore } from '@/stores/authStore';
import { useAssignableRoles } from '../useAssignableRoles';
import {
  emptyUserForm,
  toCreatePayload,
  toUpdatePayload,
  userFormFrom,
  validateUserForm,
  USERNAME_MAX,
  NAME_MAX,
  PHONE_MAX,
  type UserFormValues,
} from '../userForm';
import { usersApi, type UserRow } from '../users.api';

const FIELD_ORDER: ReadonlyArray<readonly [keyof UserFormValues, string]> = [
  ['username', 'user-username'],
  ['firstName', 'user-firstname'],
  ['lastName', 'user-lastname'],
  ['roleCode', 'user-role'],
  ['email', 'user-email'],
  ['phone', 'user-phone'],
];

export function UserFormDialog({
  user,
  prefill,
  onClose,
}: {
  user?: UserRow;
  /** Create-form values to start from, e.g. an Entra row (`userFormFromEntra`). */
  prefill?: UserFormValues;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const mode = user ? 'edit' : 'create';
  const [original] = useState<UserFormValues>(() =>
    user ? userFormFrom(user) : (prefill ?? emptyUserForm()),
  );
  // An account created from Entra signs in with Microsoft only: no password, name/email from Entra.
  const ssoOnly = !user && Boolean(original.azureObjectId);
  const microsoftLinked = Boolean(original.azureObjectId || user?.azureLinked);
  const microsoftProfile = Boolean(original.email.trim() || original.azureObjectId || user?.azureLinked);
  const entraHint = microsoftProfile ? t('users.form.fromEntraHint') : undefined;
  const [values, setValues] = useState<UserFormValues>(original);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usernameTaken, setUsernameTaken] = useState<string | null>(null);

  const roles = useAssignableRoles();

  const errors = validateUserForm(values);
  const hasErrors = Object.keys(errors).length > 0;
  const unchanged = mode === 'edit' && Object.keys(toUpdatePayload(values, original)).length === 0;
  const set = <K extends keyof UserFormValues>(key: K, value: UserFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));
  const errorOf = (key: keyof UserFormValues) =>
    touched && errors[key] ? t(errors[key]) : undefined;

  const submit = useMutation({
    mutationFn: () =>
      user
        ? usersApi.update(user.id, toUpdatePayload(values, original))
        : usersApi.create(toCreatePayload(values)),
    onSuccess: (savedUser) => {
      const current = useAuthStore.getState().user;
      if (current && current.id === savedUser.id) {
        useAuthStore.setState({ user: { ...current, username: savedUser.username } });
      }
      void qc.invalidateQueries({ queryKey: ['users'] });
      actionToast.success(
        t(user ? 'users.form.savedToast' : 'users.form.createdToast'),
        t('users.toastBody', { name: values.username.trim().toLowerCase() }),
      );
      onClose();
    },
    onError: (mutationError) => {
      const info = apiErrorOf(mutationError, t);
      if (info.code === 'USERNAME_TAKEN') setUsernameTaken(info.message);
      else setError(info.message);
      actionToast.error(t('users.form.failed'), info.message);
    },
  });

  const save = () => {
    setTouched(true);
    if (hasErrors) {
      const first = FIELD_ORDER.find(([key]) => errors[key]);
      if (first) document.getElementById(first[1])?.focus();
      return;
    }
    if (unchanged) return;
    setError(null);
    setUsernameTaken(null);
    submit.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !submit.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t('users.form.close')} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(user ? 'users.form.editTitle' : 'users.form.createTitle')}</DialogTitle>
          <DialogDescription>
            {t(ssoOnly ? 'users.form.entraDescription' : 'users.form.description')}
          </DialogDescription>
          <FormRequirementNote>{t('common.requiredExceptOptional')}</FormRequirementNote>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            id="user-username"
            label={t('users.form.username')}
            hint={microsoftLinked ? t('users.form.usernameLocked') : undefined}
            error={usernameTaken ?? errorOf('username')}
          >
            <Input
              id="user-username"
              value={values.username}
              onChange={(e) => {
                setUsernameTaken(null);
                set('username', e.target.value);
              }}
              maxLength={USERNAME_MAX + 10}
              autoComplete="off"
              disabled={microsoftLinked}
              className="min-h-11"
            />
          </FormField>
          <FormField
            id="user-firstname"
            label={t('users.form.firstName')}
            hint={entraHint}
            error={errorOf('firstName')}
          >
            <Input
              id="user-firstname"
              value={values.firstName}
              onChange={(e) => set('firstName', e.target.value)}
              maxLength={NAME_MAX}
              disabled={microsoftProfile}
              className="min-h-11"
            />
          </FormField>
          <FormField
            id="user-lastname"
            label={t('users.form.lastName')}
            optionalText={t('common.optional')}
            hint={entraHint}
            error={errorOf('lastName')}
          >
            <Input
              id="user-lastname"
              value={values.lastName}
              onChange={(e) => set('lastName', e.target.value)}
              maxLength={NAME_MAX}
              disabled={microsoftProfile}
              className="min-h-11"
            />
          </FormField>
          <FormField
            id="user-role"
            label={t('users.form.role')}
            error={errorOf('roleCode')}
          >
            <Select
              id="user-role"
              value={values.roleCode}
              onChange={(e) => set('roleCode', e.target.value)}
              disabled={roles.isPending}
            >
              <option value="">{t('users.form.select')}</option>
              {roles.roles.map((role) => (
                <option key={role.id} value={role.code}>
                  {role.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            id="user-email"
            label={t('users.form.email')}
            optionalText={t('common.optional')}
            hint={entraHint}
            error={errorOf('email')}
          >
            <Input
              id="user-email"
              type="email"
              value={values.email}
              onChange={(e) => set('email', e.target.value)}
              maxLength={255}
              disabled={microsoftProfile}
              className="min-h-11"
            />
          </FormField>
          <FormField
            id="user-phone"
            label={t('users.form.phone')}
            optionalText={t('common.optional')}
            error={errorOf('phone')}
          >
            <Input
              id="user-phone"
              type="tel"
              autoComplete="tel"
              value={values.phone}
              onChange={(e) => set('phone', e.target.value)}
              maxLength={PHONE_MAX}
              className="min-h-11"
            />
          </FormField>
          {ssoOnly ? null : (
            <FormField
              id="user-password"
              label={t('users.form.password')}
              optionalText={t('common.optional')}
              hint={t(user ? 'users.form.passwordHintEdit' : 'users.form.passwordHint')}
            >
              <PasswordInput
                id="user-password"
                showLabel={t('auth.showPassword')}
                hideLabel={t('auth.hidePassword')}
                value={values.password}
                onChange={(e) => set('password', e.target.value)}
                maxLength={200}
                autoComplete="new-password"
                className="min-h-11"
              />
            </FormField>
          )}
        </div>

        {touched && hasErrors ? (
          <Alert variant="destructive" feedbackScope="form">
            <TriangleAlert aria-hidden="true" />
            <div>
              <AlertTitle>{t('users.form.fixErrorsTitle')}</AlertTitle>
              <AlertDescription>{t('users.form.fixErrorsBody')}</AlertDescription>
            </div>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive" feedbackScope="form">
            <TriangleAlert aria-hidden="true" />
            <div>
              <AlertTitle>{t('users.form.failed')}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </div>
          </Alert>
        ) : null}

        <DialogFooter>
          {unchanged ? (
            <p className="order-last text-sm text-muted-foreground sm:order-none sm:mr-auto sm:self-center">
              {t('users.form.unchanged')}
            </p>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submit.isPending}
            className="min-h-11"
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={submit.isPending || unchanged}
            onClick={save}
            className="min-h-11 gap-2"
          >
            {submit.isPending ? (
              <Loader2 data-icon="inline-start" aria-hidden="true" className="animate-spin" />
            ) : null}
            {t(user ? 'users.form.save' : 'users.form.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

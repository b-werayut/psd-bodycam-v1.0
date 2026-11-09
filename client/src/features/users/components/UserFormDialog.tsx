import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { Select } from '@/components/ui/select';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import {
  emptyUserForm,
  toCreatePayload,
  toUpdatePayload,
  userFormFrom,
  validateUserForm,
  USERNAME_MAX,
  type UserFormValues,
} from '../userForm';
import {
  DEPARTMENTS_TREE_KEY,
  departmentsApi,
  flattenDepartments,
} from '@/features/departments/departments.api';
import { rolesApi, usersApi, type UserRow } from '../users.api';

const FIELD_ORDER: ReadonlyArray<readonly [keyof UserFormValues, string]> = [
  ['username', 'user-username'],
  ['fullName', 'user-fullname'],
  ['roleCode', 'user-role'],
  ['departmentId', 'user-department'],
  ['email', 'user-email'],
];

export function UserFormDialog({ user, onClose }: { user?: UserRow; onClose: () => void }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const mode = user ? 'edit' : 'create';
  const [original] = useState<UserFormValues>(() => (user ? userFormFrom(user) : emptyUserForm()));
  const [values, setValues] = useState<UserFormValues>(original);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usernameTaken, setUsernameTaken] = useState<string | null>(null);

  const roles = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const departments = useQuery({
    queryKey: DEPARTMENTS_TREE_KEY,
    queryFn: departmentsApi.tree,
  });
  const departmentOptions = flattenDepartments(departments.data ?? []);

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
    onSuccess: () => {
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
          <DialogDescription>{t('users.form.description')}</DialogDescription>
          <FormRequirementNote>{t('common.requiredExceptOptional')}</FormRequirementNote>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            id="user-username"
            label={t('users.form.username')}
            hint={user ? t('users.form.usernameLocked') : undefined}
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
              disabled={Boolean(user)}
              className="min-h-11"
            />
          </FormField>
          <FormField
            id="user-fullname"
            label={t('users.form.fullName')}
            error={errorOf('fullName')}
          >
            <Input
              id="user-fullname"
              value={values.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              maxLength={150}
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
              {(roles.data ?? []).map((role) => (
                <option key={role.id} value={role.code}>
                  {role.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            id="user-department"
            label={t('users.form.department')}
            optionalText={values.roleCode === 'ADMIN' ? t('common.optional') : undefined}
            hint={t('users.form.departmentHint')}
            error={errorOf('departmentId')}
          >
            <Select
              id="user-department"
              value={values.departmentId}
              onChange={(e) => set('departmentId', e.target.value)}
              disabled={departments.isPending}
            >
              <option value="">{t('users.form.noDepartment')}</option>
              {departmentOptions.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            id="user-email"
            label={t('users.form.email')}
            optionalText={t('common.optional')}
            error={errorOf('email')}
          >
            <Input
              id="user-email"
              type="email"
              value={values.email}
              onChange={(e) => set('email', e.target.value)}
              maxLength={255}
              className="min-h-11"
            />
          </FormField>
          <FormField
            id="user-password"
            label={t('users.form.password')}
            optionalText={t('common.optional')}
            hint={t(user ? 'users.form.passwordHintEdit' : 'users.form.passwordHint')}
          >
            <Input
              id="user-password"
              type="password"
              value={values.password}
              onChange={(e) => set('password', e.target.value)}
              maxLength={200}
              autoComplete="new-password"
              className="min-h-11"
            />
          </FormField>
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

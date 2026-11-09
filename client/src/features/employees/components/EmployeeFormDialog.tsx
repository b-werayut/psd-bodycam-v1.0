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
import { SearchSelect } from '@/components/ui/search-select';
import { Select } from '@/components/ui/select';
import {
  DEPARTMENTS_TREE_KEY,
  departmentsApi,
  flattenDepartments,
} from '@/features/departments/departments.api';
import { usersApi } from '@/features/users/users.api';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import {
  EMPLOYEE_CODE_MAX,
  emptyEmployeeForm,
  employeeFormFrom,
  toCreatePayload,
  toUpdatePayload,
  validateEmployeeForm,
  type EmployeeFormValues,
} from '../employeeForm';
import { EMPLOYEE_STATUS, employeesApi, type EmployeeRow } from '../employees.api';

const FIELD_ORDER: ReadonlyArray<readonly [keyof EmployeeFormValues, string]> = [
  ['employeeCode', 'employee-code'],
  ['firstName', 'employee-first-name'],
  ['lastName', 'employee-last-name'],
  ['departmentId', 'employee-department'],
];

const USER_OPTIONS_PAGE_SIZE = 100;

export function EmployeeFormDialog({
  employee,
  onClose,
}: {
  employee?: EmployeeRow;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [original] = useState<EmployeeFormValues>(() =>
    employee ? employeeFormFrom(employee) : emptyEmployeeForm(),
  );
  const [values, setValues] = useState<EmployeeFormValues>(original);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeTaken, setCodeTaken] = useState<string | null>(null);
  const [userLinked, setUserLinked] = useState<string | null>(null);

  const departments = useQuery({ queryKey: DEPARTMENTS_TREE_KEY, queryFn: departmentsApi.tree });
  const users = useQuery({
    queryKey: ['users', 'options'],
    queryFn: () => usersApi.list({ page: 1, pageSize: USER_OPTIONS_PAGE_SIZE }),
  });
  const departmentOptions = flattenDepartments(departments.data ?? []);
  const userOptions = (users.data?.data ?? []).map((user) => ({
    value: user.id,
    label: `${user.fullName} (${user.username})`,
  }));

  const errors = validateEmployeeForm(values);
  const hasErrors = Object.keys(errors).length > 0;
  const unchanged =
    Boolean(employee) && Object.keys(toUpdatePayload(values, original)).length === 0;
  const set = <K extends keyof EmployeeFormValues>(key: K, value: EmployeeFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));
  const errorOf = (key: keyof EmployeeFormValues) =>
    touched && errors[key] ? t(errors[key]) : undefined;

  const submit = useMutation({
    mutationFn: () =>
      employee
        ? employeesApi.update(employee.id, toUpdatePayload(values, original))
        : employeesApi.create(toCreatePayload(values)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employees'] });
      actionToast.success(
        t(employee ? 'employees.form.savedToast' : 'employees.form.createdToast'),
        t('employees.toastBody', { name: values.employeeCode.trim() }),
      );
      onClose();
    },
    onError: (mutationError) => {
      const info = apiErrorOf(mutationError, t);
      if (info.code === 'EMPLOYEE_CODE_TAKEN') setCodeTaken(info.message);
      else if (info.code === 'USER_ALREADY_LINKED') setUserLinked(info.message);
      else setError(info.message);
      actionToast.error(t('employees.form.failed'), info.message);
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
    setCodeTaken(null);
    setUserLinked(null);
    submit.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !submit.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t('employees.form.close')} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t(employee ? 'employees.form.editTitle' : 'employees.form.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('employees.form.description')}</DialogDescription>
          <FormRequirementNote>{t('common.requiredExceptOptional')}</FormRequirementNote>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            id="employee-code"
            label={t('employees.form.code')}
            error={codeTaken ?? errorOf('employeeCode')}
          >
            <Input
              id="employee-code"
              value={values.employeeCode}
              onChange={(e) => {
                setCodeTaken(null);
                set('employeeCode', e.target.value);
              }}
              maxLength={EMPLOYEE_CODE_MAX + 10}
              autoComplete="off"
              className="min-h-11"
            />
          </FormField>
          <FormField
            id="employee-department"
            label={t('employees.form.department')}
            error={errorOf('departmentId')}
          >
            <Select
              id="employee-department"
              value={values.departmentId}
              onChange={(e) => set('departmentId', e.target.value)}
              disabled={departments.isPending}
            >
              <option value="">{t('employees.form.selectDepartment')}</option>
              {departmentOptions.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            id="employee-first-name"
            label={t('employees.form.firstName')}
            error={errorOf('firstName')}
          >
            <Input
              id="employee-first-name"
              value={values.firstName}
              onChange={(e) => set('firstName', e.target.value)}
              maxLength={100}
              className="min-h-11"
            />
          </FormField>
          <FormField
            id="employee-last-name"
            label={t('employees.form.lastName')}
            error={errorOf('lastName')}
          >
            <Input
              id="employee-last-name"
              value={values.lastName}
              onChange={(e) => set('lastName', e.target.value)}
              maxLength={100}
              className="min-h-11"
            />
          </FormField>
          <FormField
            id="employee-phone"
            label={t('employees.form.phone')}
            optionalText={t('common.optional')}
          >
            <Input
              id="employee-phone"
              type="tel"
              value={values.phone}
              onChange={(e) => set('phone', e.target.value)}
              maxLength={30}
              className="min-h-11"
            />
          </FormField>
          <FormField
            id="employee-booking"
            label={t('employees.form.booking')}
            optionalText={t('common.optional')}
          >
            <Input
              id="employee-booking"
              value={values.bookingEmployeeRef}
              onChange={(e) => set('bookingEmployeeRef', e.target.value)}
              maxLength={100}
              autoComplete="off"
              className="min-h-11"
            />
          </FormField>
          <FormField
            id="employee-user"
            label={t('employees.form.user')}
            optionalText={t('common.optional')}
            hint={t('employees.form.userHint')}
            error={userLinked ?? undefined}
          >
            <SearchSelect
              id="employee-user"
              value={values.userId}
              onChange={(next) => {
                setUserLinked(null);
                set('userId', next);
              }}
              options={userOptions}
              placeholder={t('employees.form.userPlaceholder')}
              emptyText={t('common.pickerNotFound')}
              clearLabel={t('common.pickerClear')}
            />
          </FormField>
          {employee ? (
            <FormField id="employee-status" label={t('employees.form.status')}>
              <Select
                id="employee-status"
                value={values.status}
                onChange={(e) => set('status', e.target.value)}
              >
                <option value={EMPLOYEE_STATUS.ACTIVE}>{t('employees.status.active')}</option>
                <option value={EMPLOYEE_STATUS.SUSPENDED}>{t('employees.status.suspended')}</option>
                <option value={EMPLOYEE_STATUS.RESIGNED}>{t('employees.status.resigned')}</option>
              </Select>
            </FormField>
          ) : null}
        </div>

        {touched && hasErrors ? (
          <Alert variant="destructive" feedbackScope="form">
            <TriangleAlert aria-hidden="true" />
            <div>
              <AlertTitle>{t('employees.form.fixErrorsTitle')}</AlertTitle>
              <AlertDescription>{t('employees.form.fixErrorsBody')}</AlertDescription>
            </div>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive" feedbackScope="form">
            <TriangleAlert aria-hidden="true" />
            <div>
              <AlertTitle>{t('employees.form.failed')}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </div>
          </Alert>
        ) : null}

        <DialogFooter>
          {unchanged ? (
            <p className="order-last text-sm text-muted-foreground sm:order-none sm:mr-auto sm:self-center">
              {t('employees.form.unchanged')}
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
            {t(employee ? 'employees.form.save' : 'employees.form.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { Select } from '@/components/ui/select';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import {
  departmentFormFrom,
  emptyDepartmentForm,
  CODE_MAX,
  NAME_MAX,
  parentOptions,
  toCreatePayload,
  toUpdatePayload,
  validateDepartmentForm,
  type DepartmentFormValues,
} from '../departmentForm';
import { departmentsApi, type DepartmentNode } from '../departments.api';

const FIELD_ORDER: ReadonlyArray<readonly [keyof DepartmentFormValues, string]> = [
  ['code', 'department-code'],
  ['name', 'department-name'],
];

type Props = {
  tree: DepartmentNode[];
  /** Department being edited; omit to create. */
  department?: DepartmentNode;
  /** Pre-selected parent when creating a sub-department. */
  defaultParentId?: string;
  onClose: () => void;
};

export function DepartmentFormDialog({ tree, department, defaultParentId, onClose }: Props) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [original] = useState<DepartmentFormValues>(() =>
    department ? departmentFormFrom(department) : emptyDepartmentForm(defaultParentId ?? ''),
  );
  const [values, setValues] = useState<DepartmentFormValues>(original);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = parentOptions(tree, department?.id);
  const errors = validateDepartmentForm(values);
  const hasErrors = Object.keys(errors).length > 0;
  const unchanged =
    Boolean(department) && Object.keys(toUpdatePayload(values, original)).length === 0;
  const set = <K extends keyof DepartmentFormValues>(key: K, value: DepartmentFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));
  const errorOf = (key: keyof DepartmentFormValues) =>
    touched && errors[key] ? t(errors[key]) : undefined;

  const submit = useMutation({
    mutationFn: () =>
      department
        ? departmentsApi.update(department.id, toUpdatePayload(values, original))
        : departmentsApi.create(toCreatePayload(values)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['departments'] });
      actionToast.success(
        t(department ? 'departments.form.savedToast' : 'departments.form.createdToast'),
        t('departments.toastBody', { name: values.name.trim() }),
      );
      onClose();
    },
    onError: (mutationError) => {
      const info = apiErrorOf(mutationError, t);
      setError(info.message);
      actionToast.error(t('departments.form.failed'), info.message);
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
    submit.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !submit.isPending) onClose();
      }}
    >
      <DialogContent closeLabel={t('departments.form.close')} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t(department ? 'departments.form.editTitle' : 'departments.form.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('departments.form.description')}</DialogDescription>
          <FormRequirementNote>{t('common.requiredExceptOptional')}</FormRequirementNote>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="department-code" label={t('departments.form.code')} error={errorOf('code')}>
            <Input
              id="department-code"
              value={values.code}
              onChange={(e) => set('code', e.target.value)}
              maxLength={CODE_MAX + 10}
              autoComplete="off"
              className="min-h-11"
            />
          </FormField>
          <FormField id="department-name" label={t('departments.form.name')} error={errorOf('name')}>
            <Input
              id="department-name"
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
              maxLength={NAME_MAX + 10}
              autoComplete="off"
              className="min-h-11"
            />
          </FormField>
          <FormField
            id="department-parent"
            label={t('departments.form.parent')}
            optionalText={t('common.optional')}
            hint={department ? t('departments.form.parentHint') : undefined}
          >
            <Select
              id="department-parent"
              value={values.parentId}
              onChange={(e) => set('parentId', e.target.value)}
            >
              <option value="">{t('departments.form.noParent')}</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FormField>
          {department ? (
            <FormField id="department-status" label={t('departments.form.status')}>
              <Select
                id="department-status"
                value={values.isActive ? '1' : '0'}
                onChange={(e) => set('isActive', e.target.value === '1')}
              >
                <option value="1">{t('departments.status.active')}</option>
                <option value="0">{t('departments.status.inactive')}</option>
              </Select>
            </FormField>
          ) : null}
        </div>

        {touched && hasErrors ? (
          <Alert variant="destructive" feedbackScope="form">
            <TriangleAlert aria-hidden="true" />
            <div>
              <AlertTitle>{t('departments.form.fixErrorsTitle')}</AlertTitle>
              <AlertDescription>{t('departments.form.fixErrorsBody')}</AlertDescription>
            </div>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive" feedbackScope="form">
            <TriangleAlert aria-hidden="true" />
            <div>
              <AlertTitle>{t('departments.form.failed')}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </div>
          </Alert>
        ) : null}

        <DialogFooter>
          {unchanged ? (
            <p className="order-last text-sm text-muted-foreground sm:order-none sm:mr-auto sm:self-center">
              {t('departments.form.unchanged')}
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
            {t(department ? 'departments.form.save' : 'departments.form.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

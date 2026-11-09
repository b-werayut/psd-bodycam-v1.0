import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';

import {
  AsyncState,
  DataPagination,
  DataTableFrame,
  DataToolbar,
  PageHeader,
  RowActionItem,
  RowActionsMenu,
  StatusBadge,
  ToolButton,
  type StatusTone,
} from '@/components/command-center';
import { actionToast } from '@/components/ui/action-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DEPARTMENTS_TREE_KEY,
  departmentsApi,
  flattenDepartments,
} from '@/features/departments/departments.api';
import type { TranslationKey } from '@/i18n/locales/th';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import { queryErrorDescription } from '@/lib/queryErrorCopy';
import { usePermission } from '@/lib/usePermission';
import { EmployeeFormDialog } from './components/EmployeeFormDialog';
import { EMPLOYEE_STATUS, employeesApi, type EmployeeRow } from './employees.api';

const PAGE_SIZE = 50;

const STATUS_KEY: Record<number, TranslationKey> = {
  [EMPLOYEE_STATUS.ACTIVE]: 'employees.status.active',
  [EMPLOYEE_STATUS.SUSPENDED]: 'employees.status.suspended',
  [EMPLOYEE_STATUS.RESIGNED]: 'employees.status.resigned',
};
const STATUS_TONE: Record<number, StatusTone> = {
  [EMPLOYEE_STATUS.ACTIVE]: 'success',
  [EMPLOYEE_STATUS.SUSPENDED]: 'warning',
  [EMPLOYEE_STATUS.RESIGNED]: 'neutral',
};

export function EmployeesPage() {
  const { t } = useLanguage();
  const canManage = usePermission('org:manage');
  const qc = useQueryClient();
  const { ask, dialog: confirmDialog } = useConfirm();

  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<EmployeeRow | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = search.trim();
      setQ((prev) => {
        if (prev !== next) setPage(1);
        return next;
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  const filters = {
    page,
    pageSize: PAGE_SIZE,
    q: q || undefined,
    departmentId: departmentId || undefined,
    status: status ? Number(status) : undefined,
  };
  const filtered = Boolean(q || departmentId || status);

  const query = useQuery({
    queryKey: ['employees', 'list', filters],
    queryFn: () => employeesApi.list(filters),
  });
  const departments = useQuery({ queryKey: DEPARTMENTS_TREE_KEY, queryFn: departmentsApi.tree });
  const departmentOptions = flattenDepartments(departments.data ?? []);

  const remove = useMutation({
    mutationFn: (employee: EmployeeRow) => employeesApi.remove(employee.id),
    onSuccess: (_result, employee) => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['employees'] });
      actionToast.success(
        t('employees.deletedToast'),
        t('employees.toastBody', { name: employee.employeeCode }),
      );
    },
    onError: (deleteError) => {
      const { message } = apiErrorOf(deleteError, t);
      setError(message);
      actionToast.error(t('employees.deleteFailed'), message);
    },
  });

  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const asyncCopy = {
    loadingLabel: t('common.loading'),
    emptyTitle: t('employees.empty'),
    emptyDescription: canManage ? t('employees.emptyHint') : undefined,
    filteredEmptyTitle: t('employees.filteredEmpty'),
    filteredEmptyDescription: t('employees.filteredEmptyHint'),
    errorTitle: t('common.loadFailed'),
    errorDescription: queryErrorDescription(query.error, t),
    retryLabel: t('common.retry'),
  };

  // Toolbar Add is the view's one primary action; the empty-state copy of it is secondary.
  const addButton = (variant: 'default' | 'outline' = 'default') => (
    <Button
      variant={variant}
      onClick={() => setEditing('new')}
      className="min-h-11 w-full gap-2 sm:w-auto"
    >
      <Plus data-icon="inline-start" aria-hidden="true" className="size-3.5" />
      {t('employees.newButton')}
    </Button>
  );

  const resetPage = () => setPage(1);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
      <PageHeader title={t('employees.title')} description={t('employees.description')} />

      <DataToolbar label={t('employees.toolbar')}>
        <div className="relative w-full min-w-0 sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t('employees.search')}
            placeholder={t('employees.searchPlaceholder')}
            className="min-h-11 pl-9"
          />
        </div>
        <div className="w-full sm:w-56">
          <Select
            aria-label={t('employees.filter.department')}
            value={departmentId}
            onChange={(event) => {
              setDepartmentId(event.target.value);
              resetPage();
            }}
          >
            <option value="">{t('employees.filter.allDepartments')}</option>
            {departmentOptions.map((department) => (
              <option key={department.id} value={department.id}>
                {department.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-44">
          <Select
            aria-label={t('employees.filter.status')}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              resetPage();
            }}
          >
            <option value="">{t('employees.filter.allStatuses')}</option>
            {Object.entries(STATUS_KEY).map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </Select>
        </div>
        {canManage ? <div className="sm:ml-auto">{addButton()}</div> : null}
      </DataToolbar>

      {error ? (
        <Alert variant="destructive" feedbackScope="page">
          <AlertTitle>{t('employees.deleteFailed')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <DataTableFrame
        label={t('employees.tableCaption')}
        footer={
          <>
            <p aria-live="polite">{t('employees.summary', { shown: rows.length, total })}</p>
            {!query.isPending && !query.isError && total > 0 ? (
              <DataPagination
                page={page}
                pageCount={pageCount}
                label={t('employees.tableCaption')}
                onPageChange={setPage}
                disabled={query.isFetching}
              />
            ) : null}
          </>
        }
      >
        {query.isPending ? (
          <AsyncState state="loading" {...asyncCopy} />
        ) : query.isError ? (
          <AsyncState state="error" {...asyncCopy} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <AsyncState
            state={filtered ? 'filtered-empty' : 'empty'}
            {...asyncCopy}
            emptyAction={canManage ? addButton('outline') : undefined}
          />
        ) : (
          <Table className="min-w-[960px]">
            <TableCaption className="sr-only">{t('employees.tableCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('employees.column.code')}</TableHead>
                <TableHead>{t('employees.column.name')}</TableHead>
                <TableHead>{t('employees.column.phone')}</TableHead>
                <TableHead>{t('employees.column.department')}</TableHead>
                <TableHead>{t('employees.column.account')}</TableHead>
                <TableHead>{t('employees.column.booking')}</TableHead>
                <TableHead>{t('employees.column.status')}</TableHead>
                {canManage ? (
                  <TableHead className="w-px whitespace-nowrap text-right">
                    {t('employees.column.actions')}
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((employee) => {
                const statusKey = STATUS_KEY[employee.status];
                return (
                  <TableRow key={employee.id}>
                    <TableCell className="font-mono text-xs">{employee.employeeCode}</TableCell>
                    <TableCell className="font-medium">
                      {employee.firstName} {employee.lastName}
                    </TableCell>
                    <TableCell className="text-sm">{employee.phone ?? '—'}</TableCell>
                    <TableCell className="text-sm">{employee.departmentName ?? '—'}</TableCell>
                    <TableCell>
                      <StatusBadge tone={employee.userId ? 'success' : 'neutral'}>
                        {t(
                          employee.userId
                            ? 'employees.account.linked'
                            : 'employees.account.notLinked',
                        )}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {employee.bookingEmployeeRef ?? '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={STATUS_TONE[employee.status] ?? 'neutral'}>
                        {statusKey ? t(statusKey) : String(employee.status)}
                      </StatusBadge>
                    </TableCell>
                    {canManage ? (
                      <TableCell className="w-px whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <ToolButton
                            tone="edit"
                            aria-label={t('employees.editEmployee', { name: employee.employeeCode })}
                            title={t('employees.editEmployee', { name: employee.employeeCode })}
                            onClick={() => setEditing(employee)}
                          >
                            <Pencil aria-hidden="true" />
                          </ToolButton>
                          <RowActionsMenu
                            label={t('employees.moreActions', { name: employee.employeeCode })}
                          >
                            <RowActionItem
                              icon={<Trash2 aria-hidden="true" />}
                              label={t('employees.deleteEmployee', {
                                name: employee.employeeCode,
                              })}
                              tone="danger"
                              disabled={remove.isPending}
                              onSelect={() =>
                                ask({
                                  title: t('common.confirmDeleteTitle'),
                                  description: t('employees.deleteConfirm', {
                                    name: employee.employeeCode,
                                  }),
                                  confirmLabel: t('common.delete'),
                                  tone: 'destructive',
                                  onConfirm: () => remove.mutate(employee),
                                })
                              }
                            />
                          </RowActionsMenu>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DataTableFrame>

      {editing ? (
        <EmployeeFormDialog
          employee={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {confirmDialog}
    </div>
  );
}

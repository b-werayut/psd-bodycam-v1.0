import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';

import {
  AsyncState,
  DataTableFrame,
  DataToolbar,
  PageHeader,
} from '@/components/command-center';
import { actionToast } from '@/components/ui/action-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import { queryErrorDescription } from '@/lib/queryErrorCopy';
import { usePermission } from '@/lib/usePermission';
import { DepartmentFormDialog } from './components/DepartmentFormDialog';
import { DepartmentTree } from './components/DepartmentTree';
import { filterTree } from './departmentForm';
import {
  DEPARTMENTS_TREE_KEY,
  departmentInUseDetails,
  departmentsApi,
  flattenDepartments,
  type DepartmentNode,
} from './departments.api';

type Editing = { department?: DepartmentNode; parentId?: string } | null;

export function DepartmentsPage() {
  const { t } = useLanguage();
  const canManage = usePermission('org:manage');
  const qc = useQueryClient();
  const { ask, dialog: confirmDialog } = useConfirm();

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({ queryKey: DEPARTMENTS_TREE_KEY, queryFn: departmentsApi.tree });

  const remove = useMutation({
    mutationFn: (node: DepartmentNode) => departmentsApi.remove(node.id),
    onSuccess: (_result, node) => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['departments'] });
      actionToast.success(
        t('departments.deletedToast'),
        t('departments.toastBody', { name: node.name }),
      );
    },
    onError: (deleteError) => {
      const info = apiErrorOf(deleteError, t);
      const inUse = departmentInUseDetails(info);
      const message = inUse
        ? t('departments.inUse', { children: inUse.children, employees: inUse.employees })
        : info.message;
      setError(message);
      actionToast.error(t('departments.deleteFailed'), message);
    },
  });

  const tree = query.data ?? [];
  const visible = filterTree(tree, search);
  const total = flattenDepartments(tree).length;
  const searching = search.trim() !== '';

  const asyncCopy = {
    loadingLabel: t('common.loading'),
    emptyTitle: t('departments.empty'),
    emptyDescription: canManage ? t('departments.emptyHint') : undefined,
    filteredEmptyTitle: t('departments.filteredEmpty'),
    filteredEmptyDescription: t('departments.filteredEmptyHint'),
    errorTitle: t('common.loadFailed'),
    errorDescription: queryErrorDescription(query.error, t),
    retryLabel: t('common.retry'),
  };

  // Toolbar Add is the view's one primary action; the empty-state copy of it is secondary.
  const addButton = (variant: 'default' | 'outline' = 'default') => (
    <Button
      variant={variant}
      onClick={() => setEditing({})}
      className="min-h-11 w-full gap-2 sm:w-auto"
    >
      <Plus data-icon="inline-start" aria-hidden="true" className="size-3.5" />
      {t('departments.newButton')}
    </Button>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
      <PageHeader title={t('departments.title')} description={t('departments.description')} />

      <DataToolbar label={t('departments.toolbar')}>
        <div className="relative w-full min-w-0 sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t('departments.search')}
            placeholder={t('departments.searchPlaceholder')}
            className="min-h-11 pl-9"
          />
        </div>
        {canManage ? <div className="sm:ml-auto">{addButton()}</div> : null}
      </DataToolbar>

      {error ? (
        <Alert variant="destructive" feedbackScope="page">
          <AlertTitle>{t('departments.deleteFailed')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <DataTableFrame
        label={t('departments.treeLabel')}
        footer={<p aria-live="polite">{t('departments.summary', { count: total })}</p>}
      >
        {query.isPending ? (
          <AsyncState state="loading" {...asyncCopy} />
        ) : query.isError ? (
          <AsyncState state="error" {...asyncCopy} onRetry={() => void query.refetch()} />
        ) : visible.length === 0 ? (
          <AsyncState
            state={searching ? 'filtered-empty' : 'empty'}
            {...asyncCopy}
            emptyAction={canManage ? addButton('outline') : undefined}
          />
        ) : (
          <div className="p-3" aria-label={t('departments.treeLabel')}>
            <DepartmentTree
              nodes={visible}
              canManage={canManage}
              disabled={remove.isPending}
              onEdit={(department) => setEditing({ department })}
              onAddChild={(node) => setEditing({ parentId: node.id })}
              onDelete={(node) =>
                ask({
                  title: t('common.confirmDeleteTitle'),
                  description: t('departments.deleteConfirm', { name: node.name }),
                  confirmLabel: t('common.delete'),
                  tone: 'destructive',
                  onConfirm: () => remove.mutate(node),
                })
              }
            />
          </div>
        )}
      </DataTableFrame>

      {editing ? (
        <DepartmentFormDialog
          tree={tree}
          department={editing.department}
          defaultParentId={editing.parentId}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {confirmDialog}
    </div>
  );
}

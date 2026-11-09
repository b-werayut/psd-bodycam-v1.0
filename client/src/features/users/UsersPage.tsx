import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2, UserCheck, UserX } from 'lucide-react';

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { TranslationKey } from '@/i18n/locales/th';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import { queryErrorDescription } from '@/lib/queryErrorCopy';
import { formatDateTime } from '@/lib/time';
import { usePermission } from '@/lib/usePermission';
import { useAuthStore } from '@/stores/authStore';
import { RolePermissionsPanel } from './components/RolePermissionsPanel';
import { UserFormDialog } from './components/UserFormDialog';
import { USER_STATUS, usersApi, type UserRow } from './users.api';

const PAGE_SIZE = 50;

const STATUS_KEY: Record<number, TranslationKey> = {
  [USER_STATUS.ACTIVE]: 'users.status.active',
  [USER_STATUS.INACTIVE]: 'users.status.inactive',
  [USER_STATUS.LOCKED]: 'users.status.locked',
};
const STATUS_TONE: Record<number, StatusTone> = {
  [USER_STATUS.ACTIVE]: 'success',
  [USER_STATUS.INACTIVE]: 'neutral',
  [USER_STATUS.LOCKED]: 'destructive',
};

export function UsersPage() {
  const { t, language } = useLanguage();
  const canManage = usePermission('users:manage');
  const canManageRoles = usePermission('roles:manage');
  const currentUserId = useAuthStore((s) => s.user?.id);
  const qc = useQueryClient();
  const { ask, dialog: confirmDialog } = useConfirm();

  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [error, setError] = useState<{ titleKey: TranslationKey; message: string } | null>(null);

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

  const query = useQuery({
    queryKey: ['users', 'list', { page, q }],
    queryFn: () => usersApi.list({ page, pageSize: PAGE_SIZE, q: q || undefined }),
  });

  const setAccess = useMutation({
    mutationFn: ({ user, enabled }: { user: UserRow; enabled: boolean }) =>
      usersApi.setAccess(user.id, enabled),
    onSuccess: (_result, { user, enabled }) => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
      actionToast.success(
        t(enabled ? 'users.restoredToast' : 'users.suspendedToast'),
        t('users.toastBody', { name: user.username }),
      );
    },
    onError: (accessError) => {
      const { message } = apiErrorOf(accessError, t);
      setError({ titleKey: 'users.accessFailed', message });
      actionToast.error(t('users.accessFailed'), message);
    },
  });

  const remove = useMutation({
    mutationFn: (user: UserRow) => usersApi.remove(user.id),
    onSuccess: (_result, user) => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
      actionToast.success(t('users.deletedToast'), t('users.toastBody', { name: user.username }));
    },
    onError: (deleteError) => {
      const { message } = apiErrorOf(deleteError, t);
      setError({ titleKey: 'users.deleteFailed', message });
      actionToast.error(t('users.deleteFailed'), message);
    },
  });

  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const asyncCopy = {
    loadingLabel: t('common.loading'),
    emptyTitle: t('users.empty'),
    filteredEmptyTitle: t('users.filteredEmpty'),
    filteredEmptyDescription: t('users.filteredEmptyHint'),
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
      {t('users.newButton')}
    </Button>
  );

  const usersList = (
    <div className="flex flex-col gap-4">
      <DataToolbar label={t('users.toolbar')}>
        <div className="relative w-full min-w-0 sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t('users.search')}
            placeholder={t('users.searchPlaceholder')}
            className="min-h-11 pl-9"
          />
        </div>
        {canManage ? <div className="sm:ml-auto">{addButton()}</div> : null}
      </DataToolbar>

      {error ? (
        <Alert variant="destructive" feedbackScope="page">
          <AlertTitle>{t(error.titleKey)}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}

      <DataTableFrame
        label={t('users.tableCaption')}
        footer={
          <>
            <p aria-live="polite">{t('users.summary', { shown: rows.length, total })}</p>
            {!query.isPending && !query.isError && total > 0 ? (
              <DataPagination
                page={page}
                pageCount={pageCount}
                label={t('users.tableCaption')}
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
            state={q ? 'filtered-empty' : 'empty'}
            {...asyncCopy}
            emptyAction={canManage ? addButton('outline') : undefined}
          />
        ) : (
          <Table className="min-w-[960px]">
            <TableCaption className="sr-only">{t('users.tableCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('users.column.username')}</TableHead>
                <TableHead>{t('users.column.fullName')}</TableHead>
                <TableHead>{t('users.column.role')}</TableHead>
                <TableHead>{t('users.column.department')}</TableHead>
                <TableHead>{t('users.column.email')}</TableHead>
                <TableHead>{t('users.column.azure')}</TableHead>
                <TableHead>{t('users.column.statusLastLogin')}</TableHead>
                {canManage ? (
                  <TableHead className="w-px whitespace-nowrap text-right">
                    {t('users.column.actions')}
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((user) => {
                const isSelf = user.id === currentUserId;
                const enabled = user.status !== USER_STATUS.ACTIVE;
                const statusKey = STATUS_KEY[user.status];
                return (
                  <TableRow key={user.id}>
                    <TableCell className="font-mono text-xs">{user.username}</TableCell>
                    <TableCell className="font-medium">{user.fullName}</TableCell>
                    <TableCell className="text-sm">{user.roleName}</TableCell>
                    <TableCell className="text-sm">{user.departmentName ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{user.email ?? '—'}</TableCell>
                    <TableCell>
                      <StatusBadge tone={user.azureLinked ? 'success' : 'neutral'}>
                        {t(user.azureLinked ? 'users.azure.linked' : 'users.azure.notLinked')}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge tone={STATUS_TONE[user.status] ?? 'neutral'}>
                          {statusKey ? t(statusKey) : String(user.status)}
                        </StatusBadge>
                        <span className="text-xs text-muted-foreground">
                          {user.lastLoginAt
                            ? formatDateTime(user.lastLoginAt, language)
                            : t('users.neverLoggedIn')}
                        </span>
                      </div>
                    </TableCell>
                    {canManage ? (
                      <TableCell className="w-px whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <ToolButton
                            tone="edit"
                            aria-label={t('users.editUser', { name: user.username })}
                            title={t('users.editUser', { name: user.username })}
                            onClick={() => setEditing(user)}
                          >
                            <Pencil aria-hidden="true" />
                          </ToolButton>
                          <RowActionsMenu label={t('users.moreActions', { name: user.username })}>
                            <RowActionItem
                              icon={
                                enabled ? (
                                  <UserCheck aria-hidden="true" />
                                ) : (
                                  <UserX aria-hidden="true" />
                                )
                              }
                              label={t(enabled ? 'users.restoreUser' : 'users.suspendUser', {
                                name: user.username,
                              })}
                              tone={enabled ? 'neutral' : 'danger'}
                              reason={!enabled && isSelf ? t('users.cannotSuspendSelf') : undefined}
                              disabled={setAccess.isPending || (!enabled && isSelf)}
                              onSelect={() =>
                                ask({
                                  title: t(
                                    enabled
                                      ? 'users.restoreConfirmTitle'
                                      : 'users.suspendConfirmTitle',
                                  ),
                                  description: t(
                                    enabled
                                      ? 'users.restoreConfirmBody'
                                      : 'users.suspendConfirmBody',
                                    { name: user.username },
                                  ),
                                  confirmLabel: t(
                                    enabled
                                      ? 'users.restoreConfirmLabel'
                                      : 'users.suspendConfirmLabel',
                                  ),
                                  tone: enabled ? 'default' : 'destructive',
                                  onConfirm: () => setAccess.mutate({ user, enabled }),
                                })
                              }
                            />
                            <RowActionItem
                              icon={<Trash2 aria-hidden="true" />}
                              label={t('users.deleteUser', { name: user.username })}
                              tone="danger"
                              reason={isSelf ? t('users.cannotDeleteSelf') : undefined}
                              disabled={remove.isPending || isSelf}
                              onSelect={() =>
                                ask({
                                  title: t('common.confirmDeleteTitle'),
                                  description: t('users.deleteConfirm', { name: user.username }),
                                  confirmLabel: t('common.delete'),
                                  tone: 'destructive',
                                  onConfirm: () => remove.mutate(user),
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
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
      <PageHeader title={t('users.title')} description={t('users.description')} />

      <Tabs defaultValue="users">
        <TabsList variant="underline" aria-label={t('users.tabs.label')}>
          <TabsTrigger variant="underline" value="users">
            {t('users.tab.users')}
          </TabsTrigger>
          {canManageRoles ? (
            <TabsTrigger variant="underline" value="roles">
              {t('users.tab.roles')}
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="users">{usersList}</TabsContent>
        {canManageRoles ? (
          <TabsContent value="roles">
            <RolePermissionsPanel />
          </TabsContent>
        ) : null}
      </Tabs>

      {editing ? (
        <UserFormDialog
          user={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {confirmDialog}
    </div>
  );
}

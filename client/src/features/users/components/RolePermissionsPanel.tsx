import { Fragment, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { AsyncState, DataTableFrame } from '@/components/command-center';
import { actionToast } from '@/components/ui/action-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { PERMISSION_CATALOG, groupPermissions } from '../permissionCatalog';
import { rolesApi, type RoleRow } from '../users.api';

const GROUPS = groupPermissions();
const isAdmin = (role: RoleRow) => role.code === 'ADMIN';

export function RolePermissionsPanel() {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  const roles = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const roleList = roles.data ?? [];
  const editable = roleList.filter((role) => !isAdmin(role));
  const permissionQueries = useQueries({
    queries: editable.map((role) => ({
      queryKey: ['roles', role.id, 'permissions'],
      queryFn: () => rolesApi.permissions(role.id),
    })),
  });
  const serverOf = (roleId: string): string[] | undefined => {
    const index = editable.findIndex((role) => role.id === roleId);
    return index === -1 ? undefined : permissionQueries[index]?.data;
  };
  const ready = roles.isSuccess && permissionQueries.every((q) => q.isSuccess);
  const failed = roles.isError || permissionQueries.some((q) => q.isError);
  const loadError = roles.error ?? permissionQueries.find((q) => q.isError)?.error ?? null;

  const checkedOf = (role: RoleRow): ReadonlySet<string> =>
    isAdmin(role) ? new Set(PERMISSION_CATALOG) : new Set(draft[role.id] ?? serverOf(role.id) ?? []);

  const dirtyRoles = editable.filter((role) => {
    const edited = draft[role.id];
    if (!edited) return false;
    const server = new Set(serverOf(role.id) ?? []);
    return edited.length !== server.size || edited.some((code) => !server.has(code));
  });

  const toggle = (role: RoleRow, code: string, checked: boolean) =>
    setDraft((prev) => {
      const next = new Set(prev[role.id] ?? serverOf(role.id) ?? []);
      if (checked) next.add(code);
      else next.delete(code);
      return { ...prev, [role.id]: [...next] };
    });

  const save = useMutation({
    mutationFn: async () => {
      for (const role of dirtyRoles) {
        const wanted = new Set(draft[role.id]);
        await rolesApi.savePermissions(
          role.id,
          PERMISSION_CATALOG.filter((code) => wanted.has(code)),
        );
        await qc.invalidateQueries({ queryKey: ['roles', role.id, 'permissions'] });
        setDraft((prev) => {
          const rest = { ...prev };
          delete rest[role.id];
          return rest;
        });
      }
      return dirtyRoles.length;
    },
    onSuccess: (count) => {
      setError(null);
      actionToast.success(
        t('users.roles.savedToast'),
        t('users.roles.savedToastBody', { count }),
      );
    },
    onError: (saveError) => {
      const { message } = apiErrorOf(saveError, t);
      setError(message);
      actionToast.error(t('users.roles.saveFailed'), message);
    },
  });

  if (failed) {
    return (
      <AsyncState
        state="error"
        loadingLabel={t('common.loading')}
        emptyTitle={t('users.roles.empty')}
        filteredEmptyTitle={t('users.roles.empty')}
        errorTitle={t('common.loadFailed')}
        errorDescription={queryErrorDescription(loadError, t)}
        retryLabel={t('common.retry')}
        onRetry={() => {
          void roles.refetch();
          permissionQueries.forEach((q) => void q.refetch());
        }}
      />
    );
  }
  if (!ready) {
    return (
      <AsyncState
        state="loading"
        loadingLabel={t('common.loading')}
        emptyTitle={t('users.roles.empty')}
        filteredEmptyTitle={t('users.roles.empty')}
        errorTitle={t('common.loadFailed')}
        retryLabel={t('common.retry')}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t('users.roles.description')}</p>
        <div className="flex items-center gap-3">
          {dirtyRoles.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t('users.roles.unchanged')}</span>
          ) : null}
          <Button
            type="button"
            className="min-h-11 gap-2"
            disabled={dirtyRoles.length === 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? (
              <Loader2 data-icon="inline-start" aria-hidden="true" className="animate-spin" />
            ) : null}
            {t('users.roles.save')}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" feedbackScope="page">
          <AlertTitle>{t('users.roles.saveFailed')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <DataTableFrame label={t('users.roles.matrix')}>
        <Table className="min-w-[640px]">
          <TableCaption className="sr-only">{t('users.roles.matrix')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('users.roles.permission')}</TableHead>
              {roleList.map((role) => (
                <TableHead key={role.id} className="text-center align-top">
                  <div className="flex flex-col items-center gap-1">
                    <span>{role.name}</span>
                    {isAdmin(role) ? (
                      <span className="max-w-40 text-xs font-normal text-muted-foreground">
                        {t('users.roles.adminReadOnly')}
                      </span>
                    ) : null}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {GROUPS.map((group) => (
              <Fragment key={group.resource}>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={roleList.length + 1} className="py-2 font-semibold">
                    {t(`users.resource.${group.resource}` as TranslationKey)}
                  </TableCell>
                </TableRow>
                {group.codes.map((code) => (
                  <TableRow key={code}>
                    <TableCell className="font-mono text-xs">{code}</TableCell>
                    {roleList.map((role) => (
                      <TableCell key={role.id} className="text-center">
                        <Checkbox
                          aria-label={t('users.roles.cell', {
                            permission: code,
                            role: role.name,
                          })}
                          checked={checkedOf(role).has(code)}
                          disabled={isAdmin(role) || save.isPending}
                          onCheckedChange={(next) => toggle(role, code, next === true)}
                          className="size-5 [@media(pointer:coarse)]:size-6"
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </DataTableFrame>
    </div>
  );
}

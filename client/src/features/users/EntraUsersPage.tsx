import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  RefreshCw,
  Search,
  TriangleAlert,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';

import {
  AsyncState,
  DataPagination,
  DataTableFrame,
  DataToolbar,
  MetricSummary,
  PageHeader,
} from '@/components/command-center';
import { actionToast } from '@/components/ui/action-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import type { TranslationKey } from '@/i18n/locales/th';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import { queryErrorDescription } from '@/lib/queryErrorCopy';
import { EntraBulkCreateDialog } from './components/EntraBulkCreateDialog';
import { EntraDirectoryTable } from './components/EntraDirectoryTable';
import { UserFormDialog } from './components/UserFormDialog';
import { BULK_MAX } from './entraBulk';
import {
  conflictReasonKey,
  directoryColumns,
  entraDirectoryRows,
  entraSyncCounts,
  filterDirectoryRows,
  paginateDirectory,
  plannedWrites,
  DIRECTORY_COLUMNS,
  type EntraDirectoryRow,
  type EntraSyncCounts,
} from './entraSync';
import { userFormFromEntra, type UserFormValues } from './userForm';
import { usersApi, type EntraSyncResult } from './users.api';

const PAGE_SIZE = BULK_MAX;

const METRICS: ReadonlyArray<{
  key: keyof EntraSyncCounts;
  labelKey: TranslationKey;
  icon: typeof Users;
  tone: 'stat' | 'success' | 'info' | 'warning';
}> = [
  { key: 'entraTotal', labelKey: 'users.entraSync.counts.entraTotal', icon: Users, tone: 'stat' },
  { key: 'unchanged', labelKey: 'users.entraSync.counts.unchanged', icon: UserCheck, tone: 'success' },
  {
    key: 'missingInSystem',
    labelKey: 'users.entraSync.counts.missingInSystem',
    icon: UserPlus,
    tone: 'info',
  },
  { key: 'conflicts', labelKey: 'users.entraSync.counts.conflicts', icon: TriangleAlert, tone: 'warning' },
];

/**
 * ผู้ใช้จาก Entra: the Microsoft Entra directory against the accounts here (dry run), with
 * create-from-row (one or many, one role), link-to-existing, and apply Microsoft profile updates.
 */
export function EntraUsersPage() {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const { ask, dialog: confirmDialog } = useConfirm();

  const [matchByUsername, setMatchByUsername] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [allFields, setAllFields] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkRows, setBulkRows] = useState<EntraDirectoryRow[] | null>(null);
  const [creating, setCreating] = useState<UserFormValues | null>(null);
  const [applied, setApplied] = useState<EntraSyncResult | null>(null);
  const [error, setError] = useState<{ titleKey: TranslationKey; message: string } | null>(null);

  // Under ['users'] so every user create / update / sync invalidation also refreshes this plan.
  // Each fetch calls Microsoft Graph, so no polling and a minute of freshness.
  const directory = useQuery({
    queryKey: ['users', 'entra-directory', { matchByUsername }],
    queryFn: () =>
      matchByUsername
        ? usersApi.syncEntra({ dryRun: true, matchByUsername: true })
        : usersApi.entraDirectory(),
    staleTime: 60_000,
  });

  const link = useMutation({
    mutationFn: ({ userId, oid }: { userId: string; username: string; oid: string }) =>
      usersApi.update(userId, { azureObjectId: oid }),
    onSuccess: (_row, { username }) => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
      actionToast.success(
        t('users.entraSync.linkSucceeded'),
        t('users.entraSync.linkSucceededBody', { username }),
      );
    },
    onError: (linkError) => {
      const { message } = apiErrorOf(linkError, t);
      setError({ titleKey: 'users.entraSync.linkFailed', message });
      actionToast.error(t('users.entraSync.linkFailed'), message);
    },
  });

  const apply = useMutation({
    mutationFn: () => usersApi.syncEntra({ dryRun: false, matchByUsername }),
    onSuccess: (result) => {
      setError(null);
      setApplied(result);
      void qc.invalidateQueries({ queryKey: ['users'] });
      actionToast.success(
        t('users.entraSync.appliedTitle'),
        t('users.entraSync.appliedSummary', {
          applied: result.applied,
          unchanged: result.unchanged,
        }),
      );
    },
    onError: (applyError) => {
      const { message } = apiErrorOf(applyError, t);
      setError({ titleKey: 'users.entraSync.applyFailed', message });
      actionToast.error(t('users.entraSync.applyFailed'), message);
    },
  });

  const result = directory.data;
  const counts = result ? entraSyncCounts(result) : null;
  const writes = result ? plannedWrites(result).length : 0;
  const allRows = result ? entraDirectoryRows(result) : [];
  const shown = onlyMissing ? allRows.filter((row) => row.status === 'missing') : allRows;
  const filtered = filterDirectoryRows(shown, term);
  const view = paginateDirectory(filtered, page, PAGE_SIZE);
  const selectedRows = allRows.filter((row) => selected.has(row.id) && row.status === 'missing');
  const applySkipped = applied?.conflicts.filter((c) => c.reason === 'emailTakenOnApply') ?? [];

  const toggleRows = (rows: EntraDirectoryRow[], checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of rows) {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });

  const asyncCopy = {
    loadingLabel: t('users.entraSync.loading'),
    emptyTitle: t('users.entraSync.empty'),
    emptyDescription: t('users.entraSync.emptyHint'),
    filteredEmptyTitle: t('users.entraSync.filteredEmpty'),
    filteredEmptyDescription: t('users.entraSync.filteredEmptyHint'),
    errorTitle: t('users.entraSync.loadFailed'),
    errorDescription: queryErrorDescription(directory.error, t),
    retryLabel: t('common.retry'),
  };

  const confirmApply = () =>
    ask({
      title: t('users.entraSync.applyConfirmTitle'),
      description: t('users.entraSync.applyConfirmBody', { count: writes }),
      confirmLabel: t('users.entraSync.applyConfirmLabel', { count: writes }),
      onConfirm: () => apply.mutate(),
    });

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
      <PageHeader
        title={t('users.entraSync.title')}
        description={t('users.entraSync.description')}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={confirmApply}
            disabled={writes === 0 || apply.isPending}
            title={writes === 0 ? t('users.entraSync.noChanges') : undefined}
            className="min-h-11 gap-2"
          >
            <RefreshCw
              data-icon="inline-start"
              aria-hidden="true"
              className={apply.isPending ? 'animate-spin motion-reduce:animate-none' : undefined}
            />
            {t('users.entraSync.apply', { count: writes })}
          </Button>
        }
      />

      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card [&>*:nth-child(2n)]:border-l [&>*:nth-child(n+3)]:border-t xl:grid-cols-4 xl:[&>*:nth-child(n+2)]:border-l xl:[&>*:nth-child(n+3)]:border-t-0">
        {METRICS.map(({ key, labelKey, icon: Icon, tone }) => (
          <MetricSummary
            key={key}
            className="rounded-none border-0 border-border bg-transparent"
            label={t(labelKey)}
            tone={tone}
            icon={<Icon aria-hidden="true" strokeWidth={1.5} />}
            value={
              counts ? counts[key] : directory.isPending ? <Skeleton className="h-7 w-12" /> : '—'
            }
          />
        ))}
      </div>

      {error ? (
        <Alert variant="destructive" feedbackScope="page">
          <TriangleAlert aria-hidden="true" />
          <div>
            <AlertTitle>{t(error.titleKey)}</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </div>
        </Alert>
      ) : null}

      {applied ? (
        <Alert feedbackScope="page">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <AlertTitle>{t('users.entraSync.appliedTitle')}</AlertTitle>
            <AlertDescription>
              <p>
                {t('users.entraSync.appliedSummary', {
                  applied: applied.applied,
                  unchanged: applied.unchanged,
                })}
              </p>
              {applySkipped.length > 0 ? (
                <>
                  <p>{t('users.entraSync.appliedSkipped', { count: applySkipped.length })}</p>
                  <ul className="list-disc pl-5">
                    {applySkipped.map((conflict) => (
                      <li key={conflict.upn}>
                        {conflict.upn} · {t(conflictReasonKey(conflict.reason))}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </AlertDescription>
          </div>
        </Alert>
      ) : null}

      <DataToolbar label={t('users.entraSync.toolbar')}>
        <div className="relative w-full min-w-0 sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setPage(1);
            }}
            aria-label={t('users.entraSync.search')}
            placeholder={t('users.entraSync.searchPlaceholder')}
            className="min-h-11 pl-9"
          />
        </div>
        <div className="flex min-h-11 items-center gap-2">
          <Checkbox
            id="entra-only-missing"
            checked={onlyMissing}
            onCheckedChange={(next) => {
              setOnlyMissing(next === true);
              setPage(1);
            }}
          />
          <Label htmlFor="entra-only-missing" className="flex min-h-11 items-center">
            {t('users.entraSync.onlyMissing')}
          </Label>
        </div>
        <div className="flex min-h-11 items-center gap-2">
          <Checkbox
            id="entra-match-username"
            checked={matchByUsername}
            onCheckedChange={(next) => {
              setMatchByUsername(next === true);
              setApplied(null);
            }}
            disabled={apply.isPending}
          />
          <Label htmlFor="entra-match-username" className="flex min-h-11 items-center">
            {t('users.entraSync.matchByUsername')}
          </Label>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setAllFields((prev) => !prev)}
          className="min-h-11 sm:ml-auto"
        >
          {allFields
            ? t('users.entraSync.coreFields')
            : t('users.entraSync.allFields', { count: DIRECTORY_COLUMNS.length })}
        </Button>
      </DataToolbar>

      {matchByUsername ? (
        <p className="max-w-[75ch] text-caption text-muted-foreground">
          {t('users.entraSync.matchByUsernameHint')}
        </p>
      ) : null}

      <DataToolbar label={t('users.entraSync.selectionToolbar')}>
        <p aria-live="polite" className="text-control font-medium tabular-nums">
          {t('users.entraSync.bulk.selectedCount', { count: selectedRows.length })}
        </p>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {selectedRows.length > BULK_MAX ? (
            <p className="text-caption text-destructive">
              {t('users.entraSync.bulk.tooMany', { max: BULK_MAX })}
            </p>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={selectedRows.length === 0}
            onClick={() => setSelected(new Set())}
            className="min-h-11"
          >
            {t('users.entraSync.bulk.clearSelection')}
          </Button>
          <Button
            type="button"
            disabled={selectedRows.length === 0 || selectedRows.length > BULK_MAX}
            onClick={() => setBulkRows(selectedRows)}
            className="min-h-11 gap-2"
          >
            <UserPlus data-icon="inline-start" aria-hidden="true" />
            {t('users.entraSync.bulk.open', { count: selectedRows.length })}
          </Button>
        </div>
      </DataToolbar>

      <DataTableFrame
        label={t('users.entraSync.tableCaption')}
        footer={
          result && filtered.length > 0 ? (
            <>
              <p aria-live="polite">
                {t('users.entraSync.summary', { from: view.from, to: view.to, total: view.total })}
              </p>
              <DataPagination
                page={view.page}
                pageCount={view.pageCount}
                label={t('users.entraSync.tableCaption')}
                onPageChange={setPage}
              />
            </>
          ) : undefined
        }
      >
        {directory.isPending ? (
          <AsyncState state="loading" {...asyncCopy} />
        ) : directory.isError ? (
          <AsyncState state="error" {...asyncCopy} onRetry={() => void directory.refetch()} />
        ) : allRows.length === 0 ? (
          <AsyncState state="empty" {...asyncCopy} />
        ) : filtered.length === 0 ? (
          <AsyncState state="filtered-empty" {...asyncCopy} />
        ) : (
          <EntraDirectoryTable
            rows={view.rows}
            columns={directoryColumns(allFields)}
            wide={allFields}
            selected={selected}
            onToggle={(row) => toggleRows([row], !selected.has(row.id))}
            onTogglePage={toggleRows}
            onCreate={(row) =>
              setCreating(
                userFormFromEntra({
                  upn: row.userPrincipalName,
                  displayName: row.displayName,
                  givenName: row.givenName,
                  surname: row.surname,
                  mobilePhone: row.mobilePhone,
                  businessPhones: row.businessPhones,
                  mail: row.mail,
                  oid: row.id,
                }),
              )
            }
            onLink={(row) => {
              if (!row.linkTo) return;
              link.mutate({ userId: row.linkTo.userId, username: row.linkTo.username, oid: row.id });
            }}
            linkPendingUserId={link.isPending ? (link.variables?.userId ?? null) : null}
          />
        )}
      </DataTableFrame>

      {bulkRows ? (
        <EntraBulkCreateDialog
          rows={bulkRows}
          onClose={() => {
            setBulkRows(null);
            setSelected(new Set());
          }}
        />
      ) : null}

      {creating ? <UserFormDialog prefill={creating} onClose={() => setCreating(null)} /> : null}

      {confirmDialog}
    </div>
  );
}

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';

import { StatusBadge } from '@/components/command-center';
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
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import {
  BULK_MAX,
  bulkCreatable,
  bulkPayload,
  bulkSkipKey,
  bulkSummary,
  canSubmitBulk,
  planBulkCreate,
  type BulkOutcome,
} from '../entraBulk';
import type { EntraDirectoryRow } from '../entraSync';
import { usersApi } from '../users.api';
import { useAssignableRoles } from '../useAssignableRoles';

const listClassName =
  'flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-border px-3 py-2 text-sm';

/**
 * Creates one SSO-only account per selected Entra row with one role for the group. Each row is its
 * own POST /users, so one failure (e.g. 409 USERNAME_TAKEN) does not stop the rest.
 */
export function EntraBulkCreateDialog({
  rows,
  onClose,
}: {
  rows: EntraDirectoryRow[];
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  // Frozen at open: the directory refetches while accounts are being created.
  const [plan] = useState(() => planBulkCreate(rows));
  const [roleCode, setRoleCode] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<BulkOutcome[] | null>(null);

  const roles = useAssignableRoles();

  const creatable = bulkCreatable(plan);
  const skipped = plan.filter((candidate) => candidate.skip);
  const summary = done ? bulkSummary(done) : null;
  const tooMany = creatable.length > BULK_MAX;

  async function run() {
    setRunning(true);
    setProgress(0);
    const outcomes: BulkOutcome[] = [];
    for (const candidate of creatable) {
      const base = {
        oid: candidate.oid,
        upn: candidate.upn,
        username: candidate.values.username,
      };
      try {
        await usersApi.create(bulkPayload(candidate, { roleCode }));
        outcomes.push({ ...base, ok: true });
      } catch (cause) {
        outcomes.push({ ...base, ok: false, error: apiErrorOf(cause, t).message });
      }
      setProgress(outcomes.length);
    }
    void qc.invalidateQueries({ queryKey: ['users'] });
    setDone(outcomes);
    setRunning(false);
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !running) onClose();
      }}
    >
      <DialogContent closeLabel={t('users.entraSync.bulk.close')} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('users.entraSync.bulk.title')}</DialogTitle>
          <DialogDescription>
            {t('users.entraSync.bulk.description', { count: creatable.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
          {done && summary ? (
            <Alert
              feedbackScope="form"
              variant={summary.failed > 0 ? 'destructive' : 'default'}
            >
              {summary.failed > 0 ? (
                <TriangleAlert aria-hidden="true" />
              ) : (
                <CheckCircle2 aria-hidden="true" />
              )}
              <div>
                <AlertTitle>{t('users.entraSync.bulk.doneTitle')}</AlertTitle>
                <AlertDescription>
                  {t('users.entraSync.bulk.doneSummary', {
                    created: summary.created,
                    failed: summary.failed,
                  })}
                </AlertDescription>
              </div>
            </Alert>
          ) : (
            <>
              <Alert feedbackScope="form">
                <TriangleAlert aria-hidden="true" />
                <div>
                  <AlertTitle>{t('users.entraSync.bulk.warnTitle')}</AlertTitle>
                  <AlertDescription>{t('users.entraSync.bulk.warnBody')}</AlertDescription>
                </div>
              </Alert>
              <FormField id="entra-bulk-role" label={t('users.form.role')} className="sm:max-w-sm">
                <Select
                  id="entra-bulk-role"
                  value={roleCode}
                  onChange={(event) => setRoleCode(event.target.value)}
                  disabled={roles.isPending || running}
                >
                  <option value="">{t('users.form.select')}</option>
                  {roles.roles.map((role) => (
                    <option key={role.id} value={role.code}>
                      {role.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </>
          )}

          <section className="flex flex-col gap-1.5">
            <h3 className="text-control font-semibold">
              {done
                ? t('users.entraSync.bulk.resultTitle', { count: done.length })
                : t('users.entraSync.bulk.listTitle', { count: creatable.length })}
            </h3>
            <ul className={listClassName}>
              {done
                ? done.map((outcome) => (
                    <li key={outcome.oid} className="flex flex-wrap items-baseline gap-x-2">
                      <StatusBadge tone={outcome.ok ? 'success' : 'destructive'}>
                        {t(outcome.ok ? 'users.entraSync.bulk.created' : 'users.entraSync.bulk.failed')}
                      </StatusBadge>
                      <span className="nwl-mono text-xs">{outcome.username}</span>
                      <span className="text-muted-foreground">· {outcome.upn}</span>
                      {outcome.ok ? null : (
                        <span className="w-full text-xs text-destructive">{outcome.error}</span>
                      )}
                    </li>
                  ))
                : creatable.map((candidate) => (
                    <li key={candidate.oid} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="nwl-mono text-xs">{candidate.values.username}</span>
                      <span className="text-muted-foreground">
                        · {candidate.upn}
                        {candidate.displayName ? ` · ${candidate.displayName}` : ''}
                      </span>
                    </li>
                  ))}
            </ul>
          </section>

          {!done && skipped.length > 0 ? (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-control font-semibold">
                {t('users.entraSync.bulk.skippedTitle', { count: skipped.length })}
              </h3>
              <ul className={`${listClassName} text-muted-foreground`}>
                {skipped.map((candidate) => (
                  <li key={candidate.oid}>
                    {candidate.upn} — {candidate.skip ? t(bulkSkipKey(candidate.skip)) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!done && tooMany ? (
            <Alert variant="destructive" feedbackScope="form">
              <TriangleAlert aria-hidden="true" />
              <AlertDescription>
                {t('users.entraSync.bulk.tooMany', { max: BULK_MAX })}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant={done ? 'default' : 'ghost'}
            onClick={onClose}
            disabled={running}
            className="min-h-11"
          >
            {t(done ? 'common.close' : 'common.cancel')}
          </Button>
          {done ? null : (
            <Button
              type="button"
              onClick={() => void run()}
              disabled={running || !canSubmitBulk(plan, { roleCode })}
              className="min-h-11 gap-2"
            >
              {running ? (
                <Loader2 data-icon="inline-start" aria-hidden="true" className="animate-spin" />
              ) : null}
              {running
                ? t('users.entraSync.bulk.running', { done: progress, total: creatable.length })
                : t('users.entraSync.bulk.confirm', { count: creatable.length })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

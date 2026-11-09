import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, RotateCcw, TriangleAlert } from 'lucide-react';

import { AsyncState, DataPanel, PageHeader } from '@/components/command-center';
import { actionToast } from '@/components/ui/action-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/i18n/useLanguage';
import { apiErrorOf } from '@/lib/apiError';
import { queryErrorDescription } from '@/lib/queryErrorCopy';
import { CATEGORY_LABEL_KEY, boundHint, isTruthySetting, validateSettingInput } from './settingForm';
import { SETTINGS_KEY, VALUE_TYPE, settingsApi, type SettingItem } from './settings.api';

function SettingRow({ item }: { item: SettingItem }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const isBool = item.valueType === VALUE_TYPE.BOOL;
  const [draft, setDraft] = useState(item.value);
  const [serverError, setServerError] = useState<string | null>(null);
  const baseId = useId();
  const messageId = `${baseId}-msg`;
  const serverErrorId = `${baseId}-server`;

  const errorKey = isBool ? null : validateSettingInput(item, draft);
  const hintKey = boundHint(item);
  const params = { min: item.min ?? '', max: item.max ?? '' };
  const dirty = draft.trim() !== item.value.trim();

  const save = useMutation({
    mutationFn: (value: string) => settingsApi.update(item.key, value),
    onSuccess: (updated) => {
      setServerError(null);
      setDraft(updated.value);
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY });
      actionToast.success(t('settings.savedToast'), t('settings.savedToastBody', { key: item.key }));
    },
    onError: (error) => {
      const { message } = apiErrorOf(error, t);
      // A checkbox has no separate Save step, so a failed save must not leave it showing a value
      // the server rejected. Text inputs keep the draft so the user can fix it.
      if (isBool) setDraft(item.value);
      setServerError(message);
      actionToast.error(t('settings.saveFailed'), message);
    },
  });

  const describedBy =
    [errorKey || hintKey ? messageId : null, serverError ? serverErrorId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className="grid min-h-[72px] gap-2 border-b border-border px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-4">
      <div className="min-w-0">
        <p className="font-mono text-caption font-semibold text-link">{item.key}</p>
        {item.description ? (
          <p className="mt-0.5 text-sm font-medium text-foreground">{item.description}</p>
        ) : null}
      </div>

      <div className="flex w-full flex-col gap-1.5 md:w-auto md:min-w-[280px]">
        {isBool ? (
          <label className="flex min-h-11 items-center gap-3">
            <Checkbox
              checked={isTruthySetting(draft)}
              disabled={save.isPending}
              onCheckedChange={(checked) => {
                const next = checked === true ? 'true' : 'false';
                setDraft(next);
                setServerError(null);
                save.mutate(next);
              }}
              aria-label={t('settings.toggle', { key: item.key })}
            />
            <span className="text-sm">
              {t(isTruthySetting(draft) ? 'settings.enabled' : 'settings.disabled')}
            </span>
          </label>
        ) : (
          <div className="flex min-w-0 gap-2">
            <Input
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setServerError(null);
              }}
              inputMode={item.valueType === VALUE_TYPE.INT ? 'numeric' : 'text'}
              aria-label={t('settings.valueOf', { key: item.key })}
              aria-invalid={Boolean(errorKey || serverError)}
              aria-describedby={describedBy}
              disabled={save.isPending}
              className="min-h-11 min-w-0 flex-1"
            />
            {dirty ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  aria-label={t('settings.save', { key: item.key })}
                  aria-describedby={errorKey ? messageId : undefined}
                  disabled={save.isPending || errorKey !== null}
                  onClick={() => save.mutate(draft.trim())}
                  className="min-h-11 shrink-0"
                >
                  {save.isPending ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Check aria-hidden="true" />
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t('settings.reset', { key: item.key })}
                  disabled={save.isPending}
                  onClick={() => {
                    setDraft(item.value);
                    setServerError(null);
                  }}
                  className="min-h-11 shrink-0"
                >
                  <RotateCcw aria-hidden="true" />
                </Button>
              </>
            ) : null}
          </div>
        )}

        {errorKey ? (
          <p id={messageId} className="text-xs text-destructive">
            {t(errorKey, params)}
          </p>
        ) : hintKey ? (
          <p id={messageId} className="text-xs text-muted-foreground">
            {t(hintKey, params)}
          </p>
        ) : null}
        {serverError ? (
          <p id={serverErrorId} role="alert" className="text-xs text-destructive">
            {serverError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { t } = useLanguage();
  const query = useQuery({ queryKey: SETTINGS_KEY, queryFn: settingsApi.list });
  const groups = query.data?.groups ?? [];

  const asyncCopy = {
    loadingLabel: t('common.loading'),
    emptyTitle: t('settings.empty'),
    filteredEmptyTitle: t('settings.empty'),
    errorTitle: t('common.loadFailed'),
    errorDescription: queryErrorDescription(query.error, t),
    retryLabel: t('common.retry'),
  };

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4">
      <PageHeader title={t('settings.title')} description={t('settings.description')} />

      <Alert feedbackScope="page">
        <TriangleAlert aria-hidden="true" />
        <AlertTitle>{t('settings.warnTitle')}</AlertTitle>
        <AlertDescription>{t('settings.warnBody')}</AlertDescription>
      </Alert>

      {query.isPending ? (
        <AsyncState state="loading" {...asyncCopy} className="min-h-72" />
      ) : query.isError ? (
        <AsyncState state="error" {...asyncCopy} onRetry={() => void query.refetch()} />
      ) : groups.length === 0 ? (
        <AsyncState state="empty" {...asyncCopy} />
      ) : (
        groups.map((group) => {
          const labelKey = CATEGORY_LABEL_KEY[group.category];
          return (
            <DataPanel
              key={group.category}
              title={labelKey ? t(labelKey) : group.category}
              contentClassName="p-0"
            >
              {group.items.map((item) => (
                <SettingRow key={item.key} item={item} />
              ))}
            </DataPanel>
          );
        })
      )}
    </div>
  );
}

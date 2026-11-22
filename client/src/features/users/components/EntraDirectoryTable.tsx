import { Link2, UserPlus } from 'lucide-react';

import { StatusBadge } from '@/components/command-center';
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
import { useLanguage } from '@/i18n/useLanguage';
import { formatDateTime } from '@/lib/time';
import {
  conflictReasonKey,
  fieldLabelKey,
  rowStatusKey,
  rowStatusTone,
  type DirectoryColumn,
  type EntraDirectoryRow,
} from '../entraSync';

const MONO_FIELDS = new Set(['userPrincipalName', 'mail', 'employeeId', 'onPremisesSamAccountName', 'id']);

/**
 * One page of the Entra directory. Only rows with no account yet are selectable (bulk create);
 * each row has at most one action, so there is no overflow menu.
 */
export function EntraDirectoryTable({
  rows,
  columns,
  wide,
  selected,
  onToggle,
  onTogglePage,
  onCreate,
  onLink,
  linkPendingUserId,
}: {
  rows: EntraDirectoryRow[];
  columns: DirectoryColumn[];
  wide: boolean;
  selected: ReadonlySet<string>;
  onToggle: (row: EntraDirectoryRow) => void;
  onTogglePage: (rows: EntraDirectoryRow[], checked: boolean) => void;
  onCreate: (row: EntraDirectoryRow) => void;
  onLink: (row: EntraDirectoryRow) => void;
  linkPendingUserId: string | null;
}) {
  const { t, language } = useLanguage();
  const selectable = rows.filter((row) => row.status === 'missing');
  const pageSelected = selectable.length > 0 && selectable.every((row) => selected.has(row.id));

  const cellValue = (column: DirectoryColumn, row: EntraDirectoryRow) => {
    const value = column.get(row);
    if (value === null) return <span className="text-muted-foreground">—</span>;
    if (column.field === 'accountEnabled') {
      return t(value === 'true' ? 'users.entraSync.enabled.yes' : 'users.entraSync.enabled.no');
    }
    if (column.field === 'createdDateTime') return formatDateTime(value, language);
    if (column.field === 'id') return <span title={value}>{`${value.slice(0, 8)}…`}</span>;
    return value;
  };

  const statusLabel = (row: EntraDirectoryRow) => {
    const status = t(rowStatusKey(row.status));
    if (row.keptLocalFields.length === 0) return status;
    const fields = row.keptLocalFields
      .map((field) => {
        const labelKey = fieldLabelKey(field);
        return labelKey ? t(labelKey) : field;
      })
      .join(', ');
    return t('users.entraSync.rowStatusWithFields', { status, fields });
  };

  return (
    <Table className={wide ? 'min-w-[1800px]' : 'min-w-[1040px]'}>
      <TableCaption className="sr-only">{t('users.entraSync.tableCaption')}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              aria-label={t('users.entraSync.bulk.selectPage')}
              checked={pageSelected}
              disabled={selectable.length === 0}
              onCheckedChange={(next) => onTogglePage(selectable, next === true)}
            />
          </TableHead>
          {columns.map((column) => (
            <TableHead key={column.field}>{t(column.labelKey)}</TableHead>
          ))}
          <TableHead>{t('users.entraSync.column.status')}</TableHead>
          <TableHead className="w-px whitespace-nowrap text-right">
            {t('users.entraSync.column.actions')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              {row.status === 'missing' ? (
                <Checkbox
                  aria-label={t('users.entraSync.bulk.selectRow', { upn: row.userPrincipalName })}
                  checked={selected.has(row.id)}
                  onCheckedChange={() => onToggle(row)}
                />
              ) : null}
            </TableCell>
            {columns.map((column) => (
              <TableCell
                key={column.field}
                className={
                  MONO_FIELDS.has(column.field)
                    ? 'font-mono text-xs'
                    : column.field === 'displayName'
                      ? 'text-sm font-medium'
                      : 'text-sm'
                }
              >
                {cellValue(column, row)}
              </TableCell>
            ))}
            <TableCell>
              <div className="flex flex-col items-start gap-1">
                <StatusBadge tone={rowStatusTone(row.status)}>{statusLabel(row)}</StatusBadge>
                {row.conflictReason ? (
                  <span className="max-w-72 text-xs text-muted-foreground">
                    {t(conflictReasonKey(row.conflictReason))}
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="w-px whitespace-nowrap text-right">
              {row.status === 'missing' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5"
                  aria-label={t('users.entraSync.createUserFor', { upn: row.userPrincipalName })}
                  onClick={() => onCreate(row)}
                >
                  <UserPlus data-icon="inline-start" aria-hidden="true" />
                  {t('users.entraSync.createUser')}
                </Button>
              ) : row.linkTo ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5"
                  aria-label={t('users.entraSync.linkUserFor', {
                    upn: row.userPrincipalName,
                    username: row.linkTo.username,
                  })}
                  disabled={linkPendingUserId === row.linkTo.userId}
                  onClick={() => onLink(row)}
                >
                  <Link2 data-icon="inline-start" aria-hidden="true" />
                  {t('users.entraSync.linkUser')}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t(
                    row.status === 'conflict'
                      ? 'users.entraSync.actionNeedsReview'
                      : 'users.entraSync.actionHasAccount',
                  )}
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

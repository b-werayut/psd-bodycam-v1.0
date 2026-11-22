import type { StatusTone } from '@/components/command-center';
import type { TranslationKey } from '@/i18n/locales/th';
import type {
  EntraDirectoryUser,
  EntraSyncConflictReason,
  EntraSyncResult,
  EntraSyncUpdate,
} from './users.api';

// Ported from the reference client (features/users/entraSync.ts). This system has no department,
// company or phone data, so those Graph fields are neither shown nor searched.

const CONFLICT_KEY: Record<EntraSyncConflictReason, TranslationKey> = {
  boundToAnotherAzureAccount: 'users.entraSync.conflict.boundToAnotherAzureAccount',
  duplicateUpnFromEntra: 'users.entraSync.conflict.duplicateUpnFromEntra',
  ambiguousLocalMatch: 'users.entraSync.conflict.ambiguousLocalMatch',
  emailTakenOnApply: 'users.entraSync.conflict.emailTakenOnApply',
};

/** A reason this client does not know yet falls back to a generic "check by hand". */
export function conflictReasonKey(reason: string): TranslationKey {
  return CONFLICT_KEY[reason as EntraSyncConflictReason] ?? 'users.entraSync.conflict.unknown';
}

const FIELD_KEY: Record<string, TranslationKey> = {
  AzureObjectId: 'users.entraSync.patchField.AzureObjectId',
  Email: 'users.entraSync.patchField.Email',
  FullName: 'users.entraSync.patchField.FullName',
};

/** Label of a column the sync fills (`patch`) or keeps (`keptLocal`); null = show the raw name. */
export function fieldLabelKey(field: string): TranslationKey | null {
  return FIELD_KEY[field] ?? null;
}

export type EntraSyncCounts = {
  entraTotal: number;
  update: number;
  unchanged: number;
  missingInSystem: number;
  notInEntra: number;
  conflicts: number;
};

/** Rows with an empty patch differ from Entra but are left alone, so they are not writes. */
export function plannedWrites(result: EntraSyncResult): EntraSyncUpdate[] {
  return result.updates.filter((u) => Object.keys(u.patch).length > 0);
}

export function entraSyncCounts(result: EntraSyncResult): EntraSyncCounts {
  return {
    entraTotal: result.entraTotal,
    update: result.dryRun ? plannedWrites(result).length : result.applied,
    unchanged: result.unchanged,
    missingInSystem: result.missingInSystem.length,
    notInEntra: result.notInEntra.length,
    conflicts: result.conflicts.length,
  };
}

export function hasEntraChanges(result: EntraSyncResult): boolean {
  return plannedWrites(result).length > 0;
}

export type ScopeNote = { key: TranslationKey; values?: Record<string, string | number> };

export function scopeNotes(result: EntraSyncResult): ScopeNote[] {
  const notes: ScopeNote[] = [];
  if (result.filteredAtGraph) notes.push({ key: 'users.entraSync.scope.activeMembersOnly' });
  if (result.allowedDomains.length > 0) {
    notes.push(
      result.domainFilteredAtGraph
        ? {
            key: 'users.entraSync.scope.domainsAtGraph',
            values: { domains: result.allowedDomains.join(', '), field: result.domainField },
          }
        : {
            key: 'users.entraSync.scope.domains',
            values: {
              domains: result.allowedDomains.join(', '),
              dropped: result.entraDroppedByDomain,
            },
          },
    );
  }
  notes.push({ key: 'users.entraSync.scope.nonHumanWarning' });
  return notes;
}

export type EntraRowStatus = 'update' | 'keptLocal' | 'linked' | 'missing' | 'conflict';

export type EntraDirectoryRow = EntraDirectoryUser & {
  status: EntraRowStatus;
  keptLocalFields: string[];
  /** The local account a "link" button would bind this Entra row to (PATCH azureObjectId). */
  linkTo: { userId: string; username: string } | null;
  conflictReason: EntraSyncConflictReason | null;
};

const ROW_STATUS_KEY: Record<EntraRowStatus, TranslationKey> = {
  update: 'users.entraSync.rowStatus.update',
  keptLocal: 'users.entraSync.rowStatus.keptLocal',
  linked: 'users.entraSync.rowStatus.linked',
  missing: 'users.entraSync.rowStatus.missing',
  conflict: 'users.entraSync.rowStatus.conflict',
};

const ROW_STATUS_TONE: Record<EntraRowStatus, StatusTone> = {
  update: 'info',
  keptLocal: 'warning',
  linked: 'success',
  missing: 'neutral',
  conflict: 'destructive',
};

export function rowStatusKey(status: EntraRowStatus): TranslationKey {
  return ROW_STATUS_KEY[status];
}

export function rowStatusTone(status: EntraRowStatus): StatusTone {
  return ROW_STATUS_TONE[status];
}

const key = (value: string): string => value.trim().toLowerCase();

/** Each Entra user with how it matches an account here. Conflict wins over every other status. */
export function entraDirectoryRows(result: EntraSyncResult): EntraDirectoryRow[] {
  const conflicts = new Map(result.conflicts.map((c) => [key(c.upn), c.reason] as const));
  const missing = new Set(result.missingInSystem.map((m) => key(m.upn)));
  const writes = new Set(plannedWrites(result).map((u) => key(u.upn)));
  const kept = new Map(
    result.updates
      .filter((u) => u.keptLocal.length > 0)
      .map((u) => [key(u.upn), u.keptLocal] as const),
  );
  const linkable = new Map(
    result.updates
      .filter((u) => Boolean(u.patch.AzureObjectId))
      .map((u) => [key(u.upn), { userId: u.userId, username: u.username }] as const),
  );

  return result.entraUsers.map((user) => {
    const upn = key(user.userPrincipalName);
    const conflictReason = conflicts.get(upn) ?? null;
    const status: EntraRowStatus = conflictReason
      ? 'conflict'
      : writes.has(upn)
        ? 'update'
        : kept.has(upn)
          ? 'keptLocal'
          : missing.has(upn)
            ? 'missing'
            : 'linked';
    return {
      ...user,
      status,
      keptLocalFields: kept.get(upn) ?? [],
      linkTo: status === 'conflict' ? null : (linkable.get(upn) ?? null),
      conflictReason,
    };
  });
}

type DirectoryField =
  | 'userPrincipalName'
  | 'displayName'
  | 'givenName'
  | 'jobTitle'
  | 'accountEnabled'
  | 'userType'
  | 'mail'
  | 'surname'
  | 'officeLocation'
  | 'employeeId'
  | 'employeeType'
  | 'onPremisesSamAccountName'
  | 'createdDateTime'
  | 'id';

export type DirectoryColumn = {
  field: DirectoryField;
  labelKey: TranslationKey;
  core: boolean;
  get: (row: EntraDirectoryUser) => string | null;
  searchable?: boolean;
};

const text = (value: string | null | undefined): string | null =>
  value && value.trim() ? value : null;

const FIELD_LABEL: Record<DirectoryField, TranslationKey> = {
  userPrincipalName: 'users.entraSync.field.userPrincipalName',
  displayName: 'users.entraSync.field.displayName',
  givenName: 'users.entraSync.field.givenName',
  jobTitle: 'users.entraSync.field.jobTitle',
  accountEnabled: 'users.entraSync.field.accountEnabled',
  userType: 'users.entraSync.field.userType',
  mail: 'users.entraSync.field.mail',
  surname: 'users.entraSync.field.surname',
  officeLocation: 'users.entraSync.field.officeLocation',
  employeeId: 'users.entraSync.field.employeeId',
  employeeType: 'users.entraSync.field.employeeType',
  onPremisesSamAccountName: 'users.entraSync.field.onPremisesSamAccountName',
  createdDateTime: 'users.entraSync.field.createdDateTime',
  id: 'users.entraSync.field.id',
};

const column = (
  field: DirectoryField,
  core: boolean,
  get: (row: EntraDirectoryUser) => string | null,
  searchable = true,
): DirectoryColumn => ({ field, labelKey: FIELD_LABEL[field], core, get, searchable });

export const DIRECTORY_COLUMNS: DirectoryColumn[] = [
  column('userPrincipalName', true, (r) => text(r.userPrincipalName)),
  column('displayName', true, (r) => text(r.displayName)),
  column('givenName', true, (r) => text(r.givenName)),
  column('jobTitle', true, (r) => text(r.jobTitle)),
  column(
    'accountEnabled',
    false,
    (r) => (typeof r.accountEnabled === 'boolean' ? String(r.accountEnabled) : null),
    false,
  ),
  column('userType', false, (r) => text(r.userType)),
  column('mail', false, (r) => text(r.mail)),
  column('surname', false, (r) => text(r.surname)),
  column('officeLocation', false, (r) => text(r.officeLocation)),
  column('employeeId', false, (r) => text(r.employeeId)),
  column('employeeType', false, (r) => text(r.employeeType)),
  column('onPremisesSamAccountName', false, (r) => text(r.onPremisesSamAccountName)),
  column('createdDateTime', false, (r) => text(r.createdDateTime), false),
  column('id', false, (r) => text(r.id)),
];

export function directoryColumns(showAllFields: boolean): DirectoryColumn[] {
  return showAllFields ? DIRECTORY_COLUMNS : DIRECTORY_COLUMNS.filter((c) => c.core);
}

/** Case-insensitive match on every searchable column, shown or not. */
export function filterDirectoryRows(rows: EntraDirectoryRow[], term: string): EntraDirectoryRow[] {
  const needle = key(term);
  if (!needle) return rows;
  const searchable = DIRECTORY_COLUMNS.filter((c) => c.searchable !== false);
  return rows.filter((row) =>
    searchable.some((c) => {
      const value = c.get(row);
      return value !== null && key(value).includes(needle);
    }),
  );
}

export type DirectoryPage = {
  rows: EntraDirectoryRow[];
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
};

export function paginateDirectory(
  rows: EntraDirectoryRow[],
  page: number,
  pageSize: number,
): DirectoryPage {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(Math.floor(page) || 1, 1), pageCount);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  return {
    rows: slice,
    page: current,
    pageCount,
    from: slice.length > 0 ? start + 1 : 0,
    to: slice.length > 0 ? start + slice.length : 0,
    total: rows.length,
  };
}

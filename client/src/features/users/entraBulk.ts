import type { TranslationKey } from '@/i18n/locales/th';
import type { EntraDirectoryRow } from './entraSync';
import { toCreatePayload, userFormFromEntra, type UserFormValues } from './userForm';
import type { CreateUserPayload } from './users.api';

/** At most one table page of accounts per bulk run; each one is a separate POST /users. */
export const BULK_MAX = 50;

export type BulkSkipReason = 'notMissing' | 'usernameEmpty' | 'duplicateUsername';

const SKIP_KEY: Record<BulkSkipReason, TranslationKey> = {
  notMissing: 'users.entraSync.bulk.skip.notMissing',
  usernameEmpty: 'users.entraSync.bulk.skip.usernameEmpty',
  duplicateUsername: 'users.entraSync.bulk.skip.duplicateUsername',
};

export function bulkSkipKey(reason: BulkSkipReason): TranslationKey {
  return SKIP_KEY[reason];
}

export type BulkCandidate = {
  upn: string;
  oid: string;
  displayName: string | null;
  values: UserFormValues;
  skip?: BulkSkipReason;
};

/** Prefills every row from Entra; skips rows that have an account, no usable username, or a clash. */
export function planBulkCreate(rows: EntraDirectoryRow[]): BulkCandidate[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const values = userFormFromEntra({
      upn: row.userPrincipalName,
      displayName: row.displayName,
      givenName: row.givenName,
      surname: row.surname,
      mobilePhone: row.mobilePhone,
      businessPhones: row.businessPhones,
      mail: row.mail,
      oid: row.id,
    });
    const base: BulkCandidate = {
      upn: row.userPrincipalName,
      oid: row.id,
      displayName: row.displayName,
      values,
    };
    if (row.status !== 'missing') return { ...base, skip: 'notMissing' };
    if (!values.username) return { ...base, skip: 'usernameEmpty' };

    const username = values.username.toLowerCase();
    if (seen.has(username)) return { ...base, skip: 'duplicateUsername' };
    seen.add(username);
    return base;
  });
}

export function bulkCreatable(plan: BulkCandidate[]): BulkCandidate[] {
  return plan.filter((candidate) => !candidate.skip);
}

/** What the admin picks once for the whole group. */
export type BulkAssignment = { roleCode: string };

/** SSO-only account: values from Entra, role from the group, never a password. */
export function bulkPayload(candidate: BulkCandidate, assignment: BulkAssignment): CreateUserPayload {
  return toCreatePayload({ ...candidate.values, password: '', roleCode: assignment.roleCode });
}

export function canSubmitBulk(plan: BulkCandidate[], assignment: BulkAssignment): boolean {
  const creatable = bulkCreatable(plan).length;
  return Boolean(assignment.roleCode) && creatable > 0 && creatable <= BULK_MAX;
}

export type BulkOutcome = {
  oid: string;
  upn: string;
  username: string;
  ok: boolean;
  /** The server's (Thai) message for a failed row. */
  error?: string;
};

export function bulkSummary(outcomes: BulkOutcome[]): { created: number; failed: number } {
  return {
    created: outcomes.filter((outcome) => outcome.ok).length,
    failed: outcomes.filter((outcome) => !outcome.ok).length,
  };
}

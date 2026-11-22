import type { EntraSyncResult } from './users.api';

/** Entra oid (lowercased; Graph may send upper-case GUIDs) → current UPN. */
export function upnByOid(result: EntraSyncResult): Map<string, string> {
  return new Map(
    result.entraUsers.map((user) => [user.id.trim().toLowerCase(), user.userPrincipalName]),
  );
}

export type EntraLinkState = 'unlinked' | 'notLoaded' | 'match' | 'mismatch' | 'notFound';

export type EntraLinkView = {
  state: EntraLinkState;
  oid: string | null;
  upn: string | null;
};

const norm = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase();

/**
 * How a local account's Entra link looks against the directory: not linked, directory not loaded,
 * UPN equal to the local email, UPN changed in Entra, or oid no longer in the directory.
 */
export function entraLinkView(
  user: { email: string | null; azureObjectId: string | null },
  upnMap: Map<string, string> | null,
): EntraLinkView {
  const oid = user.azureObjectId?.trim() || null;
  if (!oid) return { state: 'unlinked', oid: null, upn: null };
  if (!upnMap) return { state: 'notLoaded', oid, upn: null };

  const upn = upnMap.get(norm(oid)) ?? null;
  if (!upn) return { state: 'notFound', oid, upn: null };
  return { state: norm(upn) === norm(user.email) ? 'match' : 'mismatch', oid, upn };
}

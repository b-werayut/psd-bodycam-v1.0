
export type EntraUser = {
  id: string;
  userPrincipalName: string;
  displayName: string | null;
  mail: string | null;
  mobilePhone: string | null;
  accountEnabled: boolean | null;
  userType: string | null;

  givenName?: string | null;
  surname?: string | null;
  businessPhones?: string[];
  jobTitle?: string | null;
  department?: string | null;
  companyName?: string | null;
  officeLocation?: string | null;
  employeeId?: string | null;
  employeeType?: string | null;
  onPremisesSamAccountName?: string | null;
  createdDateTime?: string | null;
};

// Port of the reference planner. This system's Users has no Phone column, so phone is never planned.
export type LocalUserRow = {
  Id: bigint;
  Username: string;
  Email: string | null;
  FullName: string | null;
  AzureObjectId: string | null;
};

export type UserPatch = {
  AzureObjectId?: string;
  Email?: string;
  FullName?: string;
};

export type PlannedUpdate = {
  userId: bigint;
  username: string;
  upn: string;
  patch: UserPatch;
  keptLocal: string[];
};

export type PlanConflict = {
  upn: string;
  username: string;
  reason:
    | 'boundToAnotherAzureAccount'
    | 'duplicateUpnFromEntra'
    | 'ambiguousLocalMatch'
    | 'emailTakenOnApply';
  detail: string;
};

export type EntraSyncPlan = {
  updates: PlannedUpdate[];
  unchanged: number;
  missingInSystem: { upn: string; displayName: string | null; oid: string }[];
  notInEntra: { username: string; email: string | null }[];
  conflicts: PlanConflict[];
};

const norm = (value: string | null | undefined): string =>
  (value ?? '').trim().toLowerCase();

const clean = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
};

const MAX = { Email: 200, FullName: 200 } as const;

function fillable(current: string | null, incoming: string | null, max: number): string | null {
  if (clean(current)) return null;
  const value = clean(incoming);
  if (!value || value.length > max) return null;
  return value;
}

export type PlanOptions = {
  matchByUsername?: boolean;
};

export function planEntraUserSync(
  entraUsers: EntraUser[],
  localUsers: LocalUserRow[],
  options: PlanOptions = {},
): EntraSyncPlan {
  const plan: EntraSyncPlan = {
    updates: [],
    unchanged: 0,
    missingInSystem: [],
    notInEntra: [],
    conflicts: [],
  };

  const byOid = new Map<string, LocalUserRow>();
  const byEmail = new Map<string, LocalUserRow[]>();
  const byUsername = new Map<string, LocalUserRow[]>();
  for (const row of localUsers) {
    if (row.AzureObjectId) byOid.set(norm(row.AzureObjectId), row);
    const email = norm(row.Email);
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), row]);
    if (!row.AzureObjectId && !email) {
      const username = norm(row.Username);
      if (username) byUsername.set(username, [...(byUsername.get(username) ?? []), row]);
    }
  }

  const seenUpn = new Set<string>();
  const matchedLocalIds = new Set<bigint>();

  for (const entra of entraUsers) {
    const upn = clean(entra.userPrincipalName);
    if (!upn || !entra.id) continue;

    const key = norm(upn);
    if (seenUpn.has(key)) {
      plan.conflicts.push({
        upn,
        username: '',
        reason: 'duplicateUpnFromEntra',
        detail: `Entra ส่ง UPN '${upn}' มาซ้ำในรายการเดียวกัน`,
      });
      continue;
    }
    seenUpn.add(key);

    const linked = byOid.get(norm(entra.id));
    const byEmailMatches = byEmail.get(key) ?? [];
    const usernameMatches =
      options.matchByUsername && byEmailMatches.length === 0
        ? (byUsername.get(key.slice(0, key.indexOf('@'))) ?? [])
        : [];
    const local =
      linked ??
      (byEmailMatches.length === 1 ? byEmailMatches[0] : undefined) ??
      (usernameMatches.length === 1 ? usernameMatches[0] : undefined);

    if (!linked && byEmailMatches.length > 1) {
      plan.conflicts.push({
        upn,
        username: byEmailMatches.map((r) => r.Username).join(', '),
        reason: 'ambiguousLocalMatch',
        detail: `อีเมล '${upn}' ตรงกับบัญชีในระบบ ${byEmailMatches.length} บัญชี`,
      });
      continue;
    }

    if (!local) {
      plan.missingInSystem.push({ upn, displayName: clean(entra.displayName), oid: entra.id });
      continue;
    }
    matchedLocalIds.add(local.Id);

    if (local.AzureObjectId && norm(local.AzureObjectId) !== norm(entra.id)) {
      plan.conflicts.push({
        upn,
        username: local.Username,
        reason: 'boundToAnotherAzureAccount',
        detail: `บัญชี '${local.Username}' ผูกกับ oid ${local.AzureObjectId} อยู่แล้ว`,
      });
      continue;
    }

    const patch: UserPatch = {};
    if (!local.AzureObjectId) patch.AzureObjectId = entra.id;

    const email = fillable(local.Email, upn, MAX.Email);
    if (email) patch.Email = email;
    const fullName = fillable(local.FullName, entra.displayName, MAX.FullName);
    if (fullName) patch.FullName = fullName;

    const keptLocal: string[] = [];
    if (clean(local.Email) && norm(local.Email) !== key) keptLocal.push('Email');
    if (
      clean(local.FullName) &&
      clean(entra.displayName) &&
      norm(local.FullName) !== norm(entra.displayName)
    ) {
      keptLocal.push('FullName');
    }

    if (Object.keys(patch).length === 0 && keptLocal.length === 0) {
      plan.unchanged += 1;
      continue;
    }
    if (Object.keys(patch).length === 0) {
      plan.unchanged += 1;
      plan.updates.push({
        userId: local.Id,
        username: local.Username,
        upn,
        patch: {},
        keptLocal,
      });
      continue;
    }
    plan.updates.push({ userId: local.Id, username: local.Username, upn, patch, keptLocal });
  }

  for (const row of localUsers) {
    if (!matchedLocalIds.has(row.Id)) {
      plan.notInEntra.push({ username: row.Username, email: row.Email });
    }
  }

  return plan;
}

export function planHasWrites(plan: EntraSyncPlan): boolean {
  return plan.updates.some((u) => Object.keys(u.patch).length > 0);
}

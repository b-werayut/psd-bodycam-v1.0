export const WORKER_ROLES = ['tracking', 'integration', 'media'] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

/** Parses WORKER_ROLES (comma list). Unset/empty = all roles. Result is trimmed, deduped, canonical order. */
export function parseWorkerRoles(raw: string | undefined): WorkerRole[] {
  const tokens = (raw ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [...WORKER_ROLES];

  const unknown = tokens.filter((t) => !(WORKER_ROLES as readonly string[]).includes(t));
  if (unknown.length > 0) {
    throw new Error(
      `WORKER_ROLES has unknown role(s): ${unknown.join(', ')} (allowed: ${WORKER_ROLES.join(', ')})`,
    );
  }
  return WORKER_ROLES.filter((r) => tokens.includes(r));
}

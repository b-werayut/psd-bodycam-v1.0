import { createHash } from 'node:crypto';

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) out[key] = stable((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/** sha256 (hex) of the JSON with object keys sorted at every level — key order never changes the hash. */
export function payloadHash(job: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(job)) ?? 'null').digest('hex');
}

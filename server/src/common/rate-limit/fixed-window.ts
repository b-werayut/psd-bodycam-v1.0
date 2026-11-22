export type RateLimitHit = {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
};

export type WindowEntry = { count: number; resetAt: number };
export type WindowState = Map<string, WindowEntry>;

const PRUNE_THRESHOLD = 1000;

export function hitFixedWindow(
  state: WindowState,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): RateLimitHit {
  if (state.size > PRUNE_THRESHOLD) prune(state, now);

  const entry = state.get(key);
  if (!entry || entry.resetAt <= now) {
    state.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, count: 1, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  entry.count++;
  return {
    allowed: entry.count <= limit,
    count: entry.count,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

function prune(state: WindowState, now: number): void {
  for (const [key, entry] of state) {
    if (entry.resetAt <= now) state.delete(key);
  }
}

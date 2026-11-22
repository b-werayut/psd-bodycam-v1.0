/**
 * A replaced token presented again within this window is a race between two tabs/requests that sent
 * the same cookie, not theft: answer REFRESH_RACE (the client retries once) instead of revoking everything.
 */
export const REFRESH_REUSE_GRACE_SECONDS = 10;

export type RefreshTokenState = 'live' | 'ended' | 'reuse' | 'race';

export type RefreshTokenRowLike = {
  RevokedAt: Date | null;
  ReplacedByTokenId: bigint | null;
  ReplacedAt: Date | null;
};

export function refreshTokenState(row: RefreshTokenRowLike, now: Date): RefreshTokenState {
  if (!row.RevokedAt) return 'live';
  if (row.ReplacedByTokenId === null) return 'ended';
  const replacedAt = row.ReplacedAt ?? row.RevokedAt;
  return now.getTime() - replacedAt.getTime() <= REFRESH_REUSE_GRACE_SECONDS * 1000 ? 'race' : 'reuse';
}

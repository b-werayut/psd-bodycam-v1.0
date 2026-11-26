import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { AppException } from '../../common/errors/app-exception';
import { refreshTtlMs, resolveRefreshTtl } from '../../common/config/refresh-ttl';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB, DrizzleExecutor } from '../../db/db.types';
import { RefreshTokens } from '../../db/schema';
import { refreshTokenState } from './refresh-reuse';

const invalid = (message = 'session หมดอายุหรือถูกยกเลิก กรุณาเข้าสู่ระบบใหม่') =>
  new AppException(401, 'REFRESH_INVALID', message);

/**
 * Refresh tokens are 32 random bytes; only their SHA-256 is stored. Every use rotates the token.
 * P0 issues web sessions only (no UserDevices — mobile devices arrive in P5).
 */
@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {
    for (const warning of resolveRefreshTtl(process.env).warnings) this.logger.warn(warning);
  }

  async issueRefreshToken(userId: bigint, executor: DrizzleExecutor = this.db): Promise<string> {
    const raw = newRawToken();
    await executor.insert(RefreshTokens).values({ UserId: userId, TokenHash: hashToken(raw), ExpiresAt: expiresAt() });
    return raw;
  }

  /**
   * Swaps a live token for a new one. The row is locked (FOR UPDATE) so two requests with the same
   * cookie serialize: the second sees a just-replaced token ⇒ REFRESH_RACE, and the session survives.
   * A token replaced longer ago than the grace window ⇒ theft ⇒ every session of the user is revoked.
   */
  async rotate(raw: string): Promise<{ userId: bigint; newRaw: string }> {
    const outcome = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(RefreshTokens)
        .where(eq(RefreshTokens.TokenHash, hashToken(raw)))
        .limit(1)
        .for('update');
      if (!row) return { kind: 'invalid' as const };

      const now = new Date();
      switch (refreshTokenState(row, now)) {
        case 'race':
          return { kind: 'race' as const };
        case 'reuse':
          return { kind: 'reuse' as const, userId: row.UserId };
        case 'ended':
          return { kind: 'invalid' as const };
        case 'live':
          break;
      }
      if (row.ExpiresAt.getTime() <= now.getTime()) return { kind: 'invalid' as const };

      const newRaw = newRawToken();
      const [created] = await tx
        .insert(RefreshTokens)
        .values({ UserId: row.UserId, TokenHash: hashToken(newRaw), ExpiresAt: expiresAt() })
        .returning({ Id: RefreshTokens.Id });
      await tx
        .update(RefreshTokens)
        .set({ RevokedAt: now, ReplacedAt: now, ReplacedByTokenId: created.Id })
        .where(eq(RefreshTokens.Id, row.Id));
      return { kind: 'rotated' as const, userId: row.UserId, newRaw };
    });

    switch (outcome.kind) {
      case 'rotated':
        return { userId: outcome.userId, newRaw: outcome.newRaw };
      case 'race':
        throw new AppException(401, 'REFRESH_RACE', 'session ถูกต่ออายุจากอีกแท็บพร้อมกัน กรุณาลองใหม่');
      case 'reuse':
        await this.revokeAllForUser(outcome.userId);
        this.logger.warn(`refresh token reused (user ${outcome.userId}) - revoking all sessions of the user`);
        throw invalid('ตรวจพบการใช้ session ซ้ำ ระบบยกเลิกการเข้าสู่ระบบทั้งหมดของบัญชีนี้ กรุณาเข้าสู่ระบบใหม่');
      default:
        throw invalid();
    }
  }

  /** Ends the session of this token. Returns its owner, or null for an unknown / already ended token. */
  async revoke(raw: string): Promise<bigint | null> {
    const [row] = await this.db
      .update(RefreshTokens)
      .set({ RevokedAt: new Date() })
      .where(and(eq(RefreshTokens.TokenHash, hashToken(raw)), isNull(RefreshTokens.RevokedAt)))
      .returning({ UserId: RefreshTokens.UserId });
    return row?.UserId ?? null;
  }

  /** Ends every live session of the user, except the one holding `keepRaw` (e.g. after a password change). */
  async revokeAllForUser(userId: bigint, executor: DrizzleExecutor = this.db, keepRaw?: string): Promise<number> {
    const rows = await executor
      .update(RefreshTokens)
      .set({ RevokedAt: new Date() })
      .where(
        and(
          eq(RefreshTokens.UserId, userId),
          isNull(RefreshTokens.RevokedAt),
          keepRaw ? ne(RefreshTokens.TokenHash, hashToken(keepRaw)) : undefined,
        ),
      )
      .returning({ Id: RefreshTokens.Id });
    return rows.length;
  }
}

function newRawToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function expiresAt(): Date {
  return new Date(Date.now() + refreshTtlMs(process.env, false));
}

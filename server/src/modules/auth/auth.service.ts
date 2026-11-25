import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { signAccessToken } from '../../common/auth/access-token';
import { hashPassword, verifyPassword } from '../../common/auth/password';
import type { RoleCode } from '../../common/auth/permission-catalog';
import { PermissionCheckService } from '../../common/auth/permission-check.service';
import { normalizeUsername } from '../../common/auth/username';
import { AppException } from '../../common/errors/app-exception';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Roles, Users } from '../../db/schema';
import { AUTH_SETTINGS, type AuthSettings } from './auth-settings';
import { EntraTokenVerifier } from './azure/entra-token.verifier';
import { toAuthUserView, type AuthUserView, type UserWithRole } from './auth.mapper';
import { USER_STATUS, checkLoginGate, decideFailure, lockedMessage } from './lockout';
import { TokensService } from './tokens.service';

export type SignedIn = { accessToken: string; refreshToken: string; user: AuthUserView };

/** Optional hook for the audit trail (bound by the audit module). */
export type AuthAuditEvent = {
  action: 'LOGIN' | 'LOGIN_FAILED' | 'LOGIN_SSO' | 'LOGIN_SSO_DENIED' | 'LOGOUT';
  userId: bigint | null;
  username: string | null;
  role?: string | null;
  result: 1 | 2;
  changes?: Record<string, unknown>;
};
export const AUTH_AUDIT = Symbol('AUTH_AUDIT');
export type AuthAudit = (event: AuthAuditEvent) => void;

const invalidCredentials = () => new AppException(401, 'INVALID_CREDENTIALS', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
const disabled = () => new AppException(401, 'ACCOUNT_DISABLED', 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
const locked = (minutes: number) =>
  new AppException(401, 'ACCOUNT_LOCKED_TEMPORARY', lockedMessage(minutes), { retryAfterMinutes: minutes });

@Injectable()
export class AuthService {
  private timingHash: Promise<string> | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly tokens: TokensService,
    private readonly permissions: PermissionCheckService,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
    @Inject(AUTH_AUDIT) private readonly audit: AuthAudit,
    private readonly entra: EntraTokenVerifier,
  ) {}

  async login(rawUsername: string, password: string): Promise<SignedIn> {
    const username = normalizeUsername(rawUsername);
    const [user] = await this.db
      .select({
        ...userColumns,
        PasswordHash: Users.PasswordHash,
        Status: Users.Status,
        LockedUntil: Users.LockedUntil,
      })
      .from(Users)
      .innerJoin(Roles, eq(Roles.Id, Users.RoleId))
      .where(and(sql`lower(${Users.Username}) = ${username}`, eq(Users.IsDeleted, false)))
      .limit(1);

    if (!user) {
      // Same work and answer as a wrong password: do not reveal which usernames exist.
      await verifyPassword(await this.dummyHash(), password);
      this.audit({ action: 'LOGIN_FAILED', userId: null, username, result: 2, changes: { reason: 'unknown-user' } });
      throw invalidCredentials();
    }

    // A running lock stops the attempt before the password is checked (no brute force through a lock).
    const gate = checkLoginGate({ status: USER_STATUS.ACTIVE, lockedUntil: user.LockedUntil }, new Date());
    if (!gate.ok && gate.reason === 'temporary') {
      this.audit({ action: 'LOGIN_FAILED', userId: user.Id, username, role: user.RoleCode, result: 2, changes: { reason: 'locked' } });
      throw locked(gate.retryAfterMinutes);
    }

    const passwordOk = user.PasswordHash !== null && (await verifyPassword(user.PasswordHash, password));
    if (!passwordOk) {
      const lockMinutes = await this.registerFailure(user.Id);
      this.audit({
        action: 'LOGIN_FAILED',
        userId: user.Id,
        username,
        role: user.RoleCode,
        result: 2,
        changes: { reason: lockMinutes ? 'wrong-password-locked' : 'wrong-password' },
      });
      throw lockMinutes ? locked(lockMinutes) : invalidCredentials();
    }

    if (user.Status !== USER_STATUS.ACTIVE) {
      this.audit({ action: 'LOGIN_FAILED', userId: user.Id, username, role: user.RoleCode, result: 2, changes: { reason: 'disabled' } });
      throw disabled();
    }

    await this.db
      .update(Users)
      .set({ FailedLoginCount: 0, LockedUntil: null, LastLoginAt: new Date() })
      .where(eq(Users.Id, user.Id));

    const signedIn = await this.signIn(user);
    this.audit({ action: 'LOGIN', userId: user.Id, username, role: user.RoleCode, result: 1 });
    return signedIn;
  }

  /**
   * Microsoft Entra SSO. The account must already exist (no auto-provisioning): matched by the linked
   * oid first, else by email on an account not linked yet — which then gets the oid. A password lockout
   * does not block SSO (SSO proves identity) and is lifted by it; a suspended account stays out.
   */
  async loginWithAzure(idToken: string): Promise<SignedIn> {
    const identity = await this.entra.verify(idToken);
    const select = () =>
      this.db
        .select({ ...userColumns, Status: Users.Status })
        .from(Users)
        .innerJoin(Roles, eq(Roles.Id, Users.RoleId));
    const [byOid] = await select()
      .where(and(eq(Users.AzureObjectId, identity.objectId), eq(Users.IsDeleted, false)))
      .limit(1);
    const [byEmail] = byOid
      ? [undefined]
      : await select()
          .where(
            and(
              sql`lower(${Users.Email}) = ${identity.email}`,
              isNull(Users.AzureObjectId),
              eq(Users.IsDeleted, false),
            ),
          )
          .limit(1);
    const user = byOid ?? byEmail;

    if (!user) {
      this.audit({ action: 'LOGIN_SSO_DENIED', userId: null, username: identity.email, result: 2, changes: { reason: 'no-account' } });
      throw new AppException(
        401,
        'SSO_ACCOUNT_NOT_FOUND',
        `บัญชี ${identity.email} ยังไม่ได้ลงทะเบียนในระบบ กรุณาติดต่อผู้ดูแลระบบ`,
      );
    }
    if (user.Status !== USER_STATUS.ACTIVE) {
      this.audit({
        action: 'LOGIN_SSO_DENIED',
        userId: user.Id,
        username: user.Username,
        role: user.RoleCode,
        result: 2,
        changes: { reason: 'disabled' },
      });
      throw disabled();
    }

    await this.db
      .update(Users)
      .set({ AzureObjectId: identity.objectId, FailedLoginCount: 0, LockedUntil: null, LastLoginAt: new Date() })
      .where(eq(Users.Id, user.Id));
    const signedIn = await this.signIn(user);
    this.audit({
      action: 'LOGIN_SSO',
      userId: user.Id,
      username: user.Username,
      role: user.RoleCode,
      result: 1,
      changes: byOid ? undefined : { linkedAzureAccount: true },
    });
    return signedIn;
  }

  async refresh(raw: string): Promise<SignedIn> {
    const { userId, newRaw } = await this.tokens.rotate(raw);
    const user = await this.activeUser(userId);
    if (!user) {
      await this.tokens.revokeAllForUser(userId);
      throw disabled();
    }
    const permissions = await this.permissions.roleGrants(user.RoleId, user.RoleCode as RoleCode);
    return {
      accessToken: await this.accessToken(user, permissions),
      refreshToken: newRaw,
      user: toAuthUserView(user, permissions),
    };
  }

  async logout(raw: string | undefined): Promise<void> {
    if (!raw) return;
    const owner = await this.tokens.revoke(raw);
    if (owner !== null) this.audit({ action: 'LOGOUT', userId: owner, username: null, result: 1 });
  }

  async me(userId: bigint): Promise<AuthUserView> {
    const user = await this.activeUser(userId);
    if (!user) throw new AppException(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');
    return toAuthUserView(user, await this.permissions.roleGrants(user.RoleId, user.RoleCode as RoleCode));
  }

  /** Changes the caller's password and ends every other session (the current cookie stays valid). */
  async changePassword(userId: bigint, oldPassword: string, newPassword: string, currentRaw?: string): Promise<void> {
    const [user] = await this.db
      .select({ PasswordHash: Users.PasswordHash, Username: Users.Username })
      .from(Users)
      .where(and(eq(Users.Id, userId), eq(Users.IsDeleted, false)))
      .limit(1);
    if (!user) throw new AppException(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');
    if (user.PasswordHash === null) {
      throw new AppException(400, 'PASSWORD_NOT_SET', 'บัญชีนี้เข้าสู่ระบบด้วยบัญชีองค์กร (Microsoft) จึงไม่มีรหัสผ่านให้เปลี่ยน');
    }
    if (!(await verifyPassword(user.PasswordHash, oldPassword))) {
      throw new AppException(400, 'INVALID_CURRENT_PASSWORD', 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
    }

    const passwordHash = await hashPassword(newPassword);
    await this.db.transaction(async (tx) => {
      await tx.update(Users).set({ PasswordHash: passwordHash, UpdatedAt: new Date() }).where(eq(Users.Id, userId));
      await this.tokens.revokeAllForUser(userId, tx, currentRaw);
    });
  }

  /** Counts a wrong password under a row lock. Returns the lock length in minutes when this attempt locks. */
  private async registerFailure(userId: bigint): Promise<number | null> {
    const policy = await this.settings.getLockoutPolicy();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ FailedLoginCount: Users.FailedLoginCount, LockedUntil: Users.LockedUntil })
        .from(Users)
        .where(eq(Users.Id, userId))
        .for('update');
      const now = new Date();
      const next = decideFailure({ failedCount: row.FailedLoginCount, lockedUntil: row.LockedUntil }, policy, now);
      await tx
        .update(Users)
        .set({ FailedLoginCount: next.failedCount, LockedUntil: next.lockedUntil })
        .where(eq(Users.Id, userId));
      return next.lockedUntil ? policy.lockMinutes : null;
    });
  }

  private async signIn(user: UserWithRole): Promise<SignedIn> {
    const permissions = await this.permissions.roleGrants(user.RoleId, user.RoleCode as RoleCode);
    return {
      accessToken: await this.accessToken(user, permissions),
      refreshToken: await this.tokens.issueRefreshToken(user.Id),
      user: toAuthUserView(user, permissions),
    };
  }

  private accessToken(user: UserWithRole, permissions: AuthUserView['permissions']): Promise<string> {
    return signAccessToken({
      sub: user.Id.toString(),
      username: user.Username,
      roleId: user.RoleId.toString(),
      roleCode: user.RoleCode as RoleCode,
      permissions,
    });
  }

  private async activeUser(userId: bigint): Promise<UserWithRole | undefined> {
    const [user] = await this.db
      .select(userColumns)
      .from(Users)
      .innerJoin(Roles, eq(Roles.Id, Users.RoleId))
      .where(and(eq(Users.Id, userId), eq(Users.IsDeleted, false), eq(Users.Status, USER_STATUS.ACTIVE)))
      .limit(1);
    return user;
  }

  private dummyHash(): Promise<string> {
    this.timingHash ??= hashPassword('timing-equalizer-not-a-real-password');
    return this.timingHash;
  }
}

const userColumns = {
  Id: Users.Id,
  Username: Users.Username,
  FirstName: Users.FirstName,
  LastName: Users.LastName,
  Email: Users.Email,
  RoleId: Users.RoleId,
  RoleCode: Roles.Code,
  RoleName: Roles.Name,
};

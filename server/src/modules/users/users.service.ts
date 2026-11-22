import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import type { AuthUser } from '../../common/auth/auth-user';
import { hashPassword } from '../../common/auth/password';
import { normalizeUsername } from '../../common/auth/username';
import { AppException } from '../../common/errors/app-exception';
import { likePattern } from '../../common/http/page-query.dto';
import { paged, type Paged } from '../../common/http/paged';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Employees, PushTokens, Roles, Users } from '../../db/schema';
import { USER_STATUS } from '../auth/lockout';
import { TokensService } from '../auth/tokens.service';
import { assertAssignableRole, canSeeUser } from './admin-protection';
import type { CreateUserDto } from './dto/create-user.dto';
import type { QueryUsersDto } from './dto/query-users.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import {
  REVOKE_REASON,
  SESSION_REVOCATION_NOTIFIER,
  type SessionRevocationNotifier,
} from './session-revocation.notifier';
import { planUserAccessChange, userAccessBlockerOf } from './user-access-rules';
import { toUserRow, type UserJoinedRow, type UserRowView } from './users.mapper';

const notFound = () => new AppException(404, 'NOT_FOUND', 'ไม่พบผู้ใช้');

const UNIQUE_CODES: Record<string, [string, string]> = {
  UQ_Users_Username: ['USERNAME_TAKEN', 'ชื่อผู้ใช้นี้ถูกใช้แล้ว'],
  UQ_Users_Email: ['EMAIL_TAKEN', 'อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว'],
  UQ_Users_AzureObjectId: ['AZURE_ACCOUNT_TAKEN', 'บัญชี Microsoft นี้ผูกกับผู้ใช้อื่นแล้ว'],
};

const columns = {
  Id: Users.Id,
  Username: Users.Username,
  FullName: Users.FullName,
  Email: Users.Email,
  RoleId: Users.RoleId,
  RoleCode: Roles.Code,
  RoleName: Roles.Name,
  Status: Users.Status,
  LastLoginAt: Users.LastLoginAt,
  AzureObjectId: Users.AzureObjectId,
};

@Injectable()
export class UsersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly tokens: TokensService,
    @Inject(SESSION_REVOCATION_NOTIFIER) private readonly notifier: SessionRevocationNotifier,
  ) {}

  async list(actor: AuthUser, q: QueryUsersDto): Promise<Paged<UserRowView>> {
    const where = and(...this.listFilters(actor, q));
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select(columns)
        .from(Users)
        .innerJoin(Roles, eq(Roles.Id, Users.RoleId))
        .where(where)
        .orderBy(asc(Users.Username))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(Users).innerJoin(Roles, eq(Roles.Id, Users.RoleId)).where(where),
    ]);
    return paged(
      rows.map((r) => toUserRow(r, actor)),
      Number(total),
      q.page,
      q.pageSize,
    );
  }

  async findOne(actor: AuthUser, id: bigint): Promise<UserRowView> {
    return toUserRow(await this.visible(actor, id), actor);
  }

  async create(actor: AuthUser, dto: CreateUserDto): Promise<UserRowView> {
    assertAssignableRole(actor.roleCode, dto.roleCode);
    const roleId = await this.roleIdOf(dto.roleCode);
    const username = normalizeUsername(dto.username);
    await this.assertAvailable({ username, email: dto.email, azureObjectId: dto.azureObjectId });

    const passwordHash = dto.password ? await hashPassword(dto.password) : null;
    const [row] = await this.db
      .insert(Users)
      .values({
        Username: username,
        FullName: dto.fullName,
        Email: dto.email ?? null,
        RoleId: roleId,
        PasswordHash: passwordHash,
        AzureObjectId: dto.azureObjectId ?? null,
        Status: USER_STATUS.ACTIVE,
        CreatedBy: actor.id,
        UpdatedBy: actor.id,
      })
      .returning({ Id: Users.Id })
      .catch(rethrowUnique);
    return this.findOne(actor, row.Id);
  }

  async update(actor: AuthUser, id: bigint, dto: UpdateUserDto): Promise<UserRowView> {
    await this.visible(actor, id);
    const changes: Partial<typeof Users.$inferInsert> = { UpdatedAt: new Date(), UpdatedBy: actor.id };

    if (dto.roleCode !== undefined) {
      assertAssignableRole(actor.roleCode, dto.roleCode);
      changes.RoleId = await this.roleIdOf(dto.roleCode);
    }
    if (dto.fullName !== undefined) changes.FullName = dto.fullName;
    if (dto.email !== undefined) changes.Email = dto.email;
    if (dto.azureObjectId !== undefined) changes.AzureObjectId = dto.azureObjectId;
    await this.assertAvailable({ email: dto.email, azureObjectId: dto.azureObjectId }, id);
    if (dto.password) changes.PasswordHash = await hashPassword(dto.password);

    await this.db.update(Users).set(changes).where(eq(Users.Id, id)).catch(rethrowUnique);
    if (dto.password) await this.cutAllSessions(id, REVOKE_REASON.PASSWORD_RESET);
    return this.findOne(actor, id);
  }

  async setAccess(actor: AuthUser, id: bigint, enabled: boolean) {
    const target = await this.visible(actor, id);
    if (userAccessBlockerOf(id, actor.id, enabled) === 'self') {
      throw new AppException(400, 'CANNOT_SUSPEND_SELF', 'ระงับบัญชีของตัวเองไม่ได้');
    }

    const plan = planUserAccessChange(target.Status, enabled);
    await this.db
      .update(Users)
      .set({
        Status: plan.status,
        UpdatedAt: new Date(),
        UpdatedBy: actor.id,
        // Restoring also lifts a password lockout, so an admin can unlock a locked user at once.
        ...(enabled ? { FailedLoginCount: 0, LockedUntil: null } : {}),
      })
      .where(eq(Users.Id, id));
    const cut = plan.cutSessions
      ? await this.cutAllSessions(id, REVOKE_REASON.SUSPENDED)
      : { revokedSessions: 0, revokedPushTokens: 0 };

    return { userId: id.toString(), username: target.Username, enabled, changed: plan.changed, ...cut };
  }

  async remove(actor: AuthUser, id: bigint): Promise<void> {
    await this.visible(actor, id);
    if (id === actor.id) throw new AppException(400, 'CANNOT_DELETE_SELF', 'ลบบัญชีของตัวเองไม่ได้');

    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(Users)
        .set({ IsDeleted: true, DeletedAt: now, DeletedBy: actor.id, UpdatedAt: now, UpdatedBy: actor.id })
        .where(eq(Users.Id, id));
      await tx.update(Employees).set({ UserId: null, UpdatedAt: now, UpdatedBy: actor.id }).where(eq(Employees.UserId, id));
    });
    await this.cutAllSessions(id, REVOKE_REASON.DELETED);
  }

  /** Ends every session of the user (refresh tokens + push tokens) in one transaction, then tells open sockets. */
  async cutAllSessions(userId: bigint, reason: string): Promise<{ revokedSessions: number; revokedPushTokens: number }> {
    const result = await this.db.transaction(async (tx) => {
      const revokedSessions = await this.tokens.revokeAllForUser(userId, tx);
      const pushed = await tx
        .update(PushTokens)
        .set({ IsRevoked: true })
        .where(and(eq(PushTokens.UserId, userId), eq(PushTokens.IsRevoked, false)))
        .returning({ Id: PushTokens.Id });
      return { revokedSessions, revokedPushTokens: pushed.length };
    });
    // After commit only (realtime events never precede the data they describe).
    this.notifier.notify(userId, { scope: 'account', reason });
    return result;
  }

  private listFilters(actor: AuthUser, q: QueryUsersDto): SQL[] {
    const out: SQL[] = [eq(Users.IsDeleted, false)];
    if (actor.roleCode !== 'ADMIN') out.push(ne(Roles.Code, 'ADMIN'));
    if (q.roleCode) out.push(eq(Roles.Code, q.roleCode));
    if (q.status) out.push(eq(Users.Status, q.status));
    const term = q.q?.trim();
    if (term) {
      const like = likePattern(term);
      out.push(or(ilike(Users.Username, like), ilike(Users.FullName, like), ilike(Users.Email, like)) as SQL);
    }
    return out;
  }

  /** The live user, or 404 — also 404 for an ADMIN account when the caller is not ADMIN (DL55). */
  private async visible(actor: AuthUser, id: bigint): Promise<UserJoinedRow> {
    const [row] = await this.db
      .select(columns)
      .from(Users)
      .innerJoin(Roles, eq(Roles.Id, Users.RoleId))
      .where(and(eq(Users.Id, id), eq(Users.IsDeleted, false)))
      .limit(1);
    if (!row || !canSeeUser(actor.roleCode, row.RoleCode)) throw notFound();
    return row;
  }

  private async roleIdOf(code: string): Promise<bigint> {
    const [role] = await this.db.select({ Id: Roles.Id }).from(Roles).where(eq(Roles.Code, code)).limit(1);
    if (!role) throw new AppException(400, 'UNKNOWN_ROLE', `ไม่พบบทบาท '${code}'`);
    return role.Id;
  }

  /** Friendly 409s before the insert/update; the unique indexes still catch races (rethrowUnique). */
  private async assertAvailable(
    values: { username?: string; email?: string | null; azureObjectId?: string | null },
    exceptId?: bigint,
  ): Promise<void> {
    const checks: [keyof typeof UNIQUE_CODES, SQL | undefined][] = [
      ['UQ_Users_Username', values.username ? sql`lower(${Users.Username}) = ${values.username}` : undefined],
      ['UQ_Users_Email', values.email ? sql`lower(${Users.Email}) = lower(${values.email})` : undefined],
      ['UQ_Users_AzureObjectId', values.azureObjectId ? eq(Users.AzureObjectId, values.azureObjectId) : undefined],
    ];
    for (const [constraint, condition] of checks) {
      if (!condition) continue;
      const [taken] = await this.db
        .select({ Id: Users.Id })
        .from(Users)
        .where(and(condition, eq(Users.IsDeleted, false), exceptId ? ne(Users.Id, exceptId) : undefined))
        .limit(1);
      if (taken) {
        const [code, message] = UNIQUE_CODES[constraint];
        throw new AppException(409, code, message);
      }
    }
  }
}

function rethrowUnique(error: unknown): never {
  const pg = (error as { cause?: unknown })?.cause ?? error;
  const { code, constraint_name: constraint } = (pg ?? {}) as { code?: string; constraint_name?: string };
  if (code === '23505' && constraint && UNIQUE_CODES[constraint]) {
    const [appCode, message] = UNIQUE_CODES[constraint];
    throw new AppException(409, appCode, message);
  }
  throw error;
}


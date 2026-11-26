import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/errors/app-exception';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Roles, Users } from '../../db/schema';
import type { SyncEntraUsersDto } from './dto/sync-entra-users.dto';
import {
  planEntraUserSync,
  type EntraSyncPlan,
  type EntraUser,
  type LocalUserRow,
  type PlannedUpdate,
} from './entra-user-sync.plan';
import { fetchEntraUsers, GraphConfigError, GRAPH_SELECT_FIELDS, readGraphConfig } from './graph-users.client';

/** camelCase response for the ผู้ใช้จาก Entra page; ids are strings. */
export type EntraSyncResult = Omit<EntraSyncPlan, 'updates'> & {
  updates: (Omit<PlannedUpdate, 'userId'> & { userId: string })[];
  dryRun: boolean;
  entraTotal: number;
  entraFetched: number;
  entraDroppedByDomain: number;
  filteredAtGraph: boolean;
  allowedDomains: string[];
  domainFilteredAtGraph: boolean;
  domainField: string;
  entraUsers: EntraUser[];
  entraFields: string[];
  applied: number;
};

const norm = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

/**
 * Compares the Microsoft Entra directory with Users and (when dryRun=false) links oids and updates
 * profile fields from Microsoft. Never creates or disables accounts. Non-SUPER_ADMIN callers never see SUPER_ADMIN accounts (DL55):
 * those rows and the directory entries that match them are removed before planning.
 */
@Injectable()
export class EntraUserSyncService {
  private readonly logger = new Logger(EntraUserSyncService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async sync(actor: AuthUser, dto: SyncEntraUsersDto): Promise<EntraSyncResult> {
    let config;
    try {
      config = readGraphConfig(process.env);
    } catch (cause) {
      if (cause instanceof GraphConfigError) {
        throw new AppException(
          400,
          'GRAPH_NOT_CONFIGURED',
          `ยังไม่ได้ตั้งค่าเชื่อม Microsoft Graph: ${cause.message} — ต้องใช้ App registration แยกจากที่ใช้ทำ SSO (ดู server/.env.example)`,
        );
      }
      throw cause;
    }

    const fetched = await fetchEntraUsers(config).catch((cause: Error) => {
      this.logger.error(`failed to fetch users from Microsoft Graph: ${cause.message}`);
      throw new AppException(502, 'GRAPH_UNAVAILABLE', `ติดต่อ Microsoft Graph ไม่สำเร็จ: ${cause.message}`);
    });

    const rows = await this.db
      .select({
        Id: Users.Id,
        Username: Users.Username,
        Email: Users.Email,
        Phone: Users.Phone,
        FirstName: Users.FirstName,
        LastName: Users.LastName,
        AzureObjectId: Users.AzureObjectId,
        RoleCode: Roles.Code,
      })
      .from(Users)
      .innerJoin(Roles, eq(Roles.Id, Users.RoleId))
      .where(eq(Users.IsDeleted, false));

    let local: LocalUserRow[] = rows;
    let entraUsers = fetched.users;
    if (actor.roleCode !== 'SUPER_ADMIN') {
      const admins = rows.filter((r) => r.RoleCode === 'SUPER_ADMIN');
      const oids = new Set(admins.map((a) => norm(a.AzureObjectId)).filter(Boolean));
      const emails = new Set(admins.map((a) => norm(a.Email)).filter(Boolean));
      const usernames = new Set(admins.map((a) => norm(a.Username)));
      local = rows.filter((r) => r.RoleCode !== 'SUPER_ADMIN');
      entraUsers = entraUsers.filter((u) => {
        const upn = norm(u.userPrincipalName);
        return !oids.has(norm(u.id)) && !emails.has(upn) && !usernames.has(upn.slice(0, upn.indexOf('@')));
      });
    }

    const plan = planEntraUserSync(entraUsers, local.map(stripRole), { matchByUsername: dto.matchByUsername === true });
    const dryRun = dto.dryRun !== false;
    const applied = dryRun ? 0 : await this.apply(actor, plan);

    return {
      ...plan,
      updates: plan.updates.map((u) => ({ ...u, userId: u.userId.toString() })),
      dryRun,
      applied,
      entraTotal: entraUsers.length,
      entraFetched: fetched.fetched,
      entraDroppedByDomain: fetched.droppedByDomain,
      filteredAtGraph: fetched.filteredAtGraph,
      allowedDomains: config.allowedDomains,
      domainFilteredAtGraph: fetched.domainFilteredAtGraph,
      domainField: fetched.domainField,
      entraUsers,
      entraFields: [...GRAPH_SELECT_FIELDS],
    };
  }

  /** Writes each planned patch; a row whose email is taken meanwhile becomes a conflict, the rest go on. */
  private async apply(actor: AuthUser, plan: EntraSyncPlan): Promise<number> {
    let applied = 0;
    for (const update of plan.updates) {
      if (Object.keys(update.patch).length === 0) continue;
      try {
        await this.db
          .update(Users)
          .set({ ...update.patch, UpdatedAt: new Date(), UpdatedBy: actor.id })
          .where(and(eq(Users.Id, update.userId), eq(Users.IsDeleted, false)));
        applied += 1;
      } catch (error) {
        const pg = (error as { cause?: { code?: string } }).cause ?? (error as { code?: string });
        if (pg?.code !== '23505') throw error;
        plan.conflicts.push({
          upn: update.upn,
          username: update.username,
          reason: 'emailTakenOnApply',
          detail: `อีเมลหรือบัญชี Microsoft '${update.upn}' ถูกใช้กับบัญชีอื่นแล้ว — ไม่ได้เขียน`,
        });
        update.patch = {};
      }
    }
    return applied;
  }
}

function stripRole(row: LocalUserRow & { RoleCode: string }): LocalUserRow {
  return {
    Id: row.Id, Username: row.Username, Email: row.Email, Phone: row.Phone,
    FirstName: row.FirstName, LastName: row.LastName, AzureObjectId: row.AzureObjectId,
  };
}

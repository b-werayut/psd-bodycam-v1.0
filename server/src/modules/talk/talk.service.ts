import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { AuditWriterService } from '../../common/audit/audit-writer.service';
import type { AuthUser } from '../../common/auth/auth-user';
import type { RoleCode } from '../../common/auth/permission-catalog';
import { PermissionCheckService } from '../../common/auth/permission-check.service';
import { AppException } from '../../common/errors/app-exception';
import { SettingsService } from '../../common/settings/settings.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Devices, Roles, StreamingSessions, TalkSessions, Users } from '../../db/schema';
import { USER_STATUS } from '../auth/lockout';
import {
  TALK_PROVIDER,
  TalkProviderError,
  type TalkProvider,
  type TalkStartResult,
} from './provider/talk-provider.interface';
import {
  TALK_CLOSE_CODE,
  TALK_END_REASON,
  TALK_IDLE_EXPIRE_MS,
  TALK_MESSAGE,
  TALK_OPEN_STATUSES,
  TALK_STATUS,
  TALK_VENDOR_CODE,
  talkBusyMessage,
  type TalkEndReason,
} from './talk-constants';
import {
  consumeTalkTicket,
  createTalkTicket,
  talkTicketExpiresAt,
  talkWsUrl,
  type TalkSessionRow,
} from './talk-ticket';

const TALK_PERMISSION = 'streaming:talk';
const DEVICE_RETIRED = 4;
const LIVE_SESSION_TYPE = 1;
const LIVE_ACTIVE = 2;
const IDLE_SWEEP_MS = 30_000;
const DEVICE_OPEN_INDEX = 'UX_Talk_Device_Open';
const USER_OPEN_INDEX = 'UX_Talk_User_Open';

export type TalkClosedBy = 'browser' | 'vendor' | 'system';

/** Data written to AuditLogs.Changes when Nest hangs up itself (REST stop is audited by @Audit). */
export type TalkStopAudit = { closeCode: number | null; closedBy: TalkClosedBy };

export type TalkVerdict = { ok: true } | { ok: false; closeCode: number };

export type StartTalkResult = {
  talkSessionId: string;
  wsUrl: string;
  uplinkSampleRate: number;
  downlinkSampleRate: number;
  frameMs: number;
  maxSeconds: number;
};

export type StopTalkResult = {
  talkSessionId: string;
  status: number;
  endReason: number | null;
  durationSeconds: number | null;
};

type LiveTarget = {
  liveId: bigint;
  deviceId: bigint;
  deviceCode: string;
  vendorDeviceId: string;
  deviceStatus: number;
  streamingEnabled: boolean;
};

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;
const deviceBusy = (name: string | null) => new AppException(409, 'TALK_DEVICE_BUSY', talkBusyMessage(name));
const alreadyStarting = () => new AppException(409, 'TALK_ALREADY_STARTING', TALK_MESSAGE.ALREADY_STARTING);
const userBusy = () => new AppException(409, 'TALK_USER_BUSY', TALK_MESSAGE.USER_BUSY);

@Injectable()
export class TalkService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TalkService.name);
  private idleTimer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(TALK_PROVIDER) private readonly provider: TalkProvider,
    private readonly settings: SettingsService,
    private readonly permissions: PermissionCheckService,
    private readonly audit: AuditWriterService,
  ) {}

  /** TalkIdle: sweep every 30 s. The UPDATE is conditional on status, so api and worker may both run it. */
  onModuleInit(): void {
    this.idleTimer = setInterval(() => {
      void this.expireStaleTalks().catch((error: unknown) =>
        this.logger.warn(`TalkIdle failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    }, IDLE_SWEEP_MS);
    this.idleTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.idleTimer);
  }

  /** POST /api/talk/sessions */
  async start(user: AuthUser, streamSessionToken: string): Promise<StartTalkResult> {
    if (!(await this.settings.getBool('streaming.enabled'))) {
      throw new AppException(403, 'STREAMING_DISABLED', 'ระบบปิดการดูภาพสดไว้');
    }
    // A JWT can hold a grant for up to 15 minutes after it is revoked: always re-read the DB.
    if (!(await this.canTalk(user.id))) {
      throw new AppException(403, 'FORBIDDEN', TALK_MESSAGE.DENIED);
    }
    const live = await this.findOwnActiveLive(user.id, streamSessionToken);
    if (!live.streamingEnabled || live.deviceStatus === DEVICE_RETIRED) {
      throw new AppException(403, 'DEVICE_STREAM_DISABLED', 'กล้องนี้ไม่อนุญาตให้ดูภาพสด');
    }
    await this.releaseOpenTalk(live.deviceId, user.id);
    await this.assertUserFree(user.id, live.deviceId);

    const maxSeconds = await this.settings.getInt('streaming.talk-max-seconds');
    const requested = await this.insertRequested(live, user.id);

    let started: TalkStartResult;
    try {
      started = await this.provider.start({ vendorDeviceId: live.vendorDeviceId, maxSeconds });
    } catch (error) {
      throw await this.failStart(requested, live.deviceCode, error);
    }

    const ticket = createTalkTicket();
    const startedAt = new Date();
    const [active] = await this.db
      .update(TalkSessions)
      .set({
        Status: TALK_STATUS.ACTIVE,
        StartedAt: startedAt,
        LastAccessAt: startedAt,
        VendorTalkId: started.talkId,
        UplinkSampleRate: started.uplinkSampleRate,
        FrameMs: started.frameMs,
        TicketHash: ticket.hash,
        TicketExpiresAt: talkTicketExpiresAt(startedAt),
      })
      .where(and(eq(TalkSessions.Id, requested.Id), eq(TalkSessions.Status, TALK_STATUS.REQUESTED)))
      .returning({ Id: TalkSessions.Id });
    if (!active) {
      // The row was closed while we waited for the middleware (e.g. TalkIdle): do not leave its call open.
      await this.stopVendor(started.talkId);
      throw new AppException(502, 'TALK_START_FAILED', TALK_MESSAGE.SYSTEM_ERROR);
    }

    return {
      talkSessionId: requested.Id.toString(),
      wsUrl: talkWsUrl(ticket.value),
      uplinkSampleRate: started.uplinkSampleRate,
      downlinkSampleRate: started.downlinkSampleRate,
      frameMs: started.frameMs,
      maxSeconds,
    };
  }

  /** POST /api/talk/sessions/:id/stop: owner only (others get 404), repeatable, no permission check (anyone may hang up). */
  async stop(user: AuthUser, talkSessionId: bigint): Promise<StopTalkResult> {
    const [row] = await this.db
      .select()
      .from(TalkSessions)
      .where(and(eq(TalkSessions.Id, talkSessionId), eq(TalkSessions.UserId, user.id)))
      .limit(1);
    if (!row) throw new AppException(404, 'TALK_NOT_FOUND', TALK_MESSAGE.NOT_FOUND);
    if (!TALK_OPEN_STATUSES.includes(row.Status)) return toStopResult(row);

    const ended = await this.end(row, TALK_END_REASON.USER_STOPPED);
    if (ended) {
      await this.stopVendor(row.VendorTalkId);
      return toStopResult(ended);
    }
    // The relay closed it in the same instant: return the latest state.
    const [latest] = await this.db.select().from(TalkSessions).where(eq(TalkSessions.Id, row.Id)).limit(1);
    return toStopResult(latest);
  }

  consumeTicket(ticket: string): Promise<TalkSessionRow | null> {
    return consumeTalkTicket(this.db, ticket);
  }

  /**
   * The relay calls this every 15 s. A WebSocket has no request context, so the user and role are loaded
   * from the row. Covers a revoked grant, a suspended user, a disabled device and an ended live view.
   */
  async revalidate(talkSessionId: bigint, now: Date = new Date()): Promise<TalkVerdict> {
    const [state] = await this.db
      .select({
        row: TalkSessions,
        userStatus: Users.Status,
        userDeleted: Users.IsDeleted,
        roleId: Users.RoleId,
        roleCode: Roles.Code,
        liveStatus: StreamingSessions.Status,
        deviceStatus: Devices.Status,
        deviceDeleted: Devices.IsDeleted,
        streamingEnabled: Devices.StreamingEnabled,
      })
      .from(TalkSessions)
      .innerJoin(Users, eq(Users.Id, TalkSessions.UserId))
      .innerJoin(Roles, eq(Roles.Id, Users.RoleId))
      .innerJoin(StreamingSessions, eq(StreamingSessions.Id, TalkSessions.StreamingSessionId))
      .innerJoin(Devices, eq(Devices.Id, TalkSessions.DeviceId))
      .where(eq(TalkSessions.Id, talkSessionId))
      .limit(1);
    if (!state || state.row.Status !== TALK_STATUS.ACTIVE) {
      return { ok: false, closeCode: TALK_CLOSE_CODE.STOPPED };
    }

    const stateAllowed =
      (await this.settings.getBool('streaming.enabled')) &&
      state.userStatus === USER_STATUS.ACTIVE &&
      !state.userDeleted &&
      state.roleCode !== 'TEAM_LEADER' &&
      state.liveStatus === LIVE_ACTIVE &&
      state.deviceStatus !== DEVICE_RETIRED &&
      !state.deviceDeleted &&
      state.streamingEnabled;
    const permitted =
      stateAllowed &&
      (await this.permissions.roleGrants(state.roleId, state.roleCode as RoleCode)).includes(TALK_PERMISSION);

    if (!permitted) {
      await this.endWithAudit(
        state.row,
        TALK_END_REASON.POLICY_DISABLED,
        { closeCode: TALK_CLOSE_CODE.POLICY, closedBy: 'system' },
        now,
      );
      return { ok: false, closeCode: TALK_CLOSE_CODE.POLICY };
    }

    await this.db
      .update(TalkSessions)
      .set({ LastAccessAt: now })
      .where(and(eq(TalkSessions.Id, talkSessionId), eq(TalkSessions.Status, TALK_STATUS.ACTIVE)));
    return { ok: true };
  }

  /**
   * The only place a row is closed. Idempotent (`WHERE Status IN (1, 2)`): returns null when someone
   * closed it first, never overwriting their EndReason. `failure` closes it as FAILED with an ErrorMessage.
   */
  async end(
    row: Pick<TalkSessionRow, 'Id' | 'StartedAt'>,
    reason: TalkEndReason,
    options: { now?: Date; failure?: string } = {},
  ): Promise<TalkSessionRow | null> {
    const now = options.now ?? new Date();
    const failure = options.failure;
    const [updated] = await this.db
      .update(TalkSessions)
      .set({
        Status: failure === undefined ? TALK_STATUS.ENDED : TALK_STATUS.FAILED,
        EndReason: reason,
        EndedAt: now,
        DurationSeconds: row.StartedAt
          ? Math.max(0, Math.round((now.getTime() - row.StartedAt.getTime()) / 1000))
          : null,
        TicketHash: null,
        ...(failure === undefined ? {} : { ErrorMessage: failure.slice(0, 500) }),
      })
      .where(and(eq(TalkSessions.Id, row.Id), inArray(TalkSessions.Status, TALK_OPEN_STATUSES)))
      .returning();
    return updated ?? null;
  }

  /** Close a call Nest hangs up itself (or the browser dropped) and write the STOP_TALK audit. */
  async endWithAudit(
    row: TalkSessionRow,
    reason: TalkEndReason,
    audit: TalkStopAudit,
    now: Date = new Date(),
  ): Promise<TalkSessionRow | null> {
    const ended = await this.end(row, reason, { now });
    if (ended) await this.auditStop(ended, audit);
    return ended;
  }

  /** For the relay: close the row, audit, tell the middleware to drop the call. Never throws (TalkIdle is the backstop). */
  async hangUp(row: TalkSessionRow, reason: TalkEndReason, audit: TalkStopAudit): Promise<void> {
    try {
      const ended = await this.endWithAudit(row, reason, audit);
      if (ended) await this.stopVendor(row.VendorTalkId);
    } catch (error) {
      this.logger.error(`hang up of call ${row.Id} failed: ${(error as Error).message}. TalkIdle will close it later`);
    }
  }

  /**
   * TalkIdle: an open call whose LastAccessAt (or RequestedAt) is older than 60 s is EXPIRED. Covers an API that
   * died mid-call and a browser that vanished before the WS connected. The relay bumps LastAccessAt every 15 s.
   */
  async expireStaleTalks(now: Date = new Date()): Promise<number> {
    const deadline = now.getTime() - TALK_IDLE_EXPIRE_MS;
    const open = await this.db
      .select()
      .from(TalkSessions)
      .where(inArray(TalkSessions.Status, TALK_OPEN_STATUSES));

    let closed = 0;
    for (const row of open) {
      const lastSeen = row.LastAccessAt ?? row.RequestedAt;
      if (lastSeen.getTime() > deadline) continue;
      const ended = await this.endWithAudit(
        row,
        TALK_END_REASON.EXPIRED,
        { closeCode: null, closedBy: 'system' },
        now,
      );
      if (!ended) continue;
      await this.stopVendor(row.VendorTalkId);
      closed += 1;
    }
    if (closed > 0) this.logger.warn(`expired ${closed} stale talk call(s)`);
    return closed;
  }

  /** Fresh Users + Roles read (same shape as StreamingService.currentAccess). */
  private async canTalk(userId: bigint): Promise<boolean> {
    const [user] = await this.db
      .select({ roleId: Users.RoleId, roleCode: Roles.Code })
      .from(Users)
      .innerJoin(Roles, eq(Roles.Id, Users.RoleId))
      .where(and(eq(Users.Id, userId), eq(Users.Status, USER_STATUS.ACTIVE), eq(Users.IsDeleted, false)));
    if (!user || user.roleCode === 'TEAM_LEADER') return false;
    const grants = await this.permissions.roleGrants(user.roleId, user.roleCode as RoleCode);
    return grants.includes(TALK_PERMISSION);
  }

  private async findOwnActiveLive(userId: bigint, token: string): Promise<LiveTarget> {
    const [live] = await this.db
      .select({
        liveId: StreamingSessions.Id,
        deviceId: Devices.Id,
        deviceCode: Devices.DeviceCode,
        vendorDeviceId: Devices.VendorDeviceId,
        deviceStatus: Devices.Status,
        streamingEnabled: Devices.StreamingEnabled,
      })
      .from(StreamingSessions)
      .innerJoin(Devices, eq(Devices.Id, StreamingSessions.DeviceId))
      .where(
        and(
          eq(StreamingSessions.SessionToken, token),
          eq(StreamingSessions.UserId, userId),
          eq(StreamingSessions.SessionType, LIVE_SESSION_TYPE),
          eq(StreamingSessions.Status, LIVE_ACTIVE),
          eq(Devices.IsDeleted, false),
        ),
      )
      .limit(1);
    if (!live) throw new AppException(404, 'TALK_LIVE_NOT_FOUND', TALK_MESSAGE.NO_LIVE);
    return live;
  }

  private async releaseOpenTalk(deviceId: bigint, userId: bigint): Promise<void> {
    const open = await this.db
      .select({ row: TalkSessions, firstName: Users.FirstName, lastName: Users.LastName })
      .from(TalkSessions)
      .innerJoin(Users, eq(Users.Id, TalkSessions.UserId))
      .where(and(eq(TalkSessions.DeviceId, deviceId), inArray(TalkSessions.Status, TALK_OPEN_STATUSES)));

    for (const { row, firstName, lastName } of open) {
      // Our own call still connecting (double click / two tabs while the middleware answers): wait, never steal.
      if (row.UserId === userId && row.Status === TALK_STATUS.REQUESTED) throw alreadyStarting();
      if (row.UserId !== userId) throw deviceBusy(fullName({ firstName, lastName }));
      // Our own stale call on this device (e.g. an old tab): hang it up, then start fresh.
      await this.endWithAudit(row, TALK_END_REASON.USER_STOPPED, {
        closeCode: TALK_CLOSE_CODE.STOPPED,
        closedBy: 'system',
      });
      await this.stopVendor(row.VendorTalkId);
    }
  }

  /** One call per user: an open call on another camera is a 409 (we do not hang it up for them). */
  private async assertUserFree(userId: bigint, deviceId: bigint): Promise<void> {
    const [other] = await this.db
      .select({ Id: TalkSessions.Id })
      .from(TalkSessions)
      .where(
        and(
          eq(TalkSessions.UserId, userId),
          ne(TalkSessions.DeviceId, deviceId),
          inArray(TalkSessions.Status, TALK_OPEN_STATUSES),
        ),
      )
      .limit(1);
    if (other) throw userBusy();
  }

  private async insertRequested(live: LiveTarget, userId: bigint): Promise<TalkSessionRow> {
    try {
      const [row] = await this.db
        .insert(TalkSessions)
        .values({
          DeviceId: live.deviceId,
          UserId: userId,
          StreamingSessionId: live.liveId,
          Status: TALK_STATUS.REQUESTED,
        })
        .returning();
      return row;
    } catch (error) {
      // Simultaneous requests passed the pre-checks; the DB lets only one open call per device and per user.
      if (isUniqueViolation(error, USER_OPEN_INDEX)) throw userBusy();
      if (isUniqueViolation(error, DEVICE_OPEN_INDEX)) {
        // Postgres reports the device index first even for our own double click: re-read who holds the device.
        const owner = await this.openTalkOwner(live.deviceId);
        if (owner?.userId === userId) throw alreadyStarting();
        throw deviceBusy(owner?.name ?? null);
      }
      throw error;
    }
  }

  private async openTalkOwner(deviceId: bigint): Promise<{ userId: bigint; name: string } | null> {
    const [owner] = await this.db
      .select({ userId: Users.Id, firstName: Users.FirstName, lastName: Users.LastName })
      .from(TalkSessions)
      .innerJoin(Users, eq(Users.Id, TalkSessions.UserId))
      .where(and(eq(TalkSessions.DeviceId, deviceId), inArray(TalkSessions.Status, TALK_OPEN_STATUSES)))
      .limit(1);
    return owner ? { userId: owner.userId, name: fullName(owner) } : null;
  }

  private async failStart(row: TalkSessionRow, deviceCode: string, error: unknown): Promise<AppException> {
    const known = error instanceof TalkProviderError ? error : null;
    const detail = error instanceof Error ? error.message : String(error);
    await this.end(row, TALK_END_REASON.VENDOR_ERROR, { failure: detail });
    this.logger.error(`talk start on device '${deviceCode}' failed: ${detail}`);
    if (known?.vendorCode === TALK_VENDOR_CODE.BUSY) {
      return new AppException(409, 'TALK_DEVICE_BUSY', known.userMessage);
    }
    // Only the provider's Thai userMessage reaches the client, never the middleware's raw text.
    return new AppException(502, 'TALK_START_FAILED', known?.userMessage ?? TALK_MESSAGE.SYSTEM_ERROR);
  }

  private async stopVendor(talkId: string | null): Promise<void> {
    if (!talkId) return;
    try {
      await this.provider.stop(talkId);
    } catch (error) {
      this.logger.warn(`middleware stop of call ${talkId.slice(0, 6)}... failed: ${(error as Error).message}`);
    }
  }

  private async auditStop(row: TalkSessionRow, audit: TalkStopAudit): Promise<void> {
    try {
      const [actor] = await this.db
        .select({ username: Users.Username, roleCode: Roles.Code })
        .from(Users)
        .innerJoin(Roles, eq(Roles.Id, Users.RoleId))
        .where(eq(Users.Id, row.UserId))
        .limit(1);
      // The call's owner is the actor. The relay / TalkIdle path has no request context, so pass everything.
      await this.audit.insert({
        action: 'STOP_TALK',
        result: 1,
        resourceType: 'TalkSessions',
        resourceId: row.Id,
        userId: row.UserId,
        actorUsername: actor?.username ?? null,
        actorRole: actor?.roleCode ?? null,
        changes: {
          endReason: row.EndReason,
          closeCode: audit.closeCode,
          closedBy: audit.closedBy,
          durationSeconds: row.DurationSeconds,
        },
      });
    } catch (error) {
      this.logger.error(`STOP_TALK audit of call ${row.Id} failed: ${(error as Error).message}`);
    }
  }
}

function toStopResult(row: TalkSessionRow): StopTalkResult {
  return {
    talkSessionId: row.Id.toString(),
    status: row.Status,
    endReason: row.EndReason ?? null,
    durationSeconds: row.DurationSeconds ?? null,
  };
}

/** drizzle wraps postgres.js errors in `cause`: check both layers. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    const pg = candidate as { code?: unknown; constraint_name?: unknown } | null | undefined;
    if (pg?.code === '23505' && pg.constraint_name === constraint) return true;
  }
  return false;
}

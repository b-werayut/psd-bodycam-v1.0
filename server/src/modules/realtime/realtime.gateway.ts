import { Inject, Logger } from '@nestjs/common';
import { type OnGatewayConnection, type OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { and, eq } from 'drizzle-orm';
import type { Namespace, Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../../common/auth/access-token';
import { PermissionCheckService } from '../../common/auth/permission-check.service';
import type { RoleCode } from '../../common/auth/permission-catalog';
import type { JwtPayload } from '../../common/auth/auth-user';
import { corsOrigins } from '../../common/config/cors';
import { RealtimeEmitterService } from '../../common/realtime-bus/realtime-emitter.service';
import { REALTIME_NAMESPACE, type BroadcastBus } from '../../common/realtime-bus/realtime-bus.types';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Roles, Users } from '../../db/schema';
import { USER_STATUS } from '../auth/lockout';
import type { SessionRevocation } from '../users/session-revocation.notifier';
import { roomsForClient, userRoom } from './realtime-rooms';

/**
 * `connect_error` message when the handshake token is missing / invalid / belongs to an account that
 * can no longer sign in. The client refreshes its token and calls `socket.connect()` (socket.io does not
 * retry after a middleware refusal). ASCII only — matches client `lib/socket.ts`.
 */
export const REALTIME_UNAUTHORIZED = 'unauthorized';

@WebSocketGateway({ namespace: REALTIME_NAMESPACE, cors: { origin: corsOrigins(), credentials: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);
  private warnedNoBus = false;

  /** Set only in the api process; the worker pushes through the Redis emitter instead. */
  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly emitter: RealtimeEmitterService,
  ) {}

  /** Authenticate in the handshake middleware so a refusal is a `connect_error`, not a silent drop. */
  afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        () => next(new Error(REALTIME_UNAUTHORIZED)),
      );
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const user = client.data.user as JwtPayload | undefined;
    if (!user) {
      client.disconnect(true);
      return;
    }
    const access = client.data.access as { roleCode: string; permissions: string[] } | undefined;
    await client.join(roomsForClient({ sub: user.sub, roleCode: access?.roleCode ?? '', permissions: access?.permissions ?? [] }));
  }

  /**
   * Ends every open socket of the user (suspend, delete, admin password reset): the client signs out at
   * once instead of waiting for its access token to expire. Covers web and mobile (both are in user:{id}).
   */
  revokeUserSessions(userId: bigint, payload: SessionRevocation): void {
    const bus = this.bus;
    if (!bus) return;
    try {
      bus.to(userRoom(userId)).emit('session:revoked', payload);
      bus.to(userRoom(userId)).disconnectSockets?.(true);
    } catch (error) {
      this.logger.warn(`ตัด session ของผู้ใช้ ${userId} ผ่าน realtime ไม่สำเร็จ: ${String(error)}`);
    }
  }

  /** Socket.IO server in the api, Redis emitter in the worker, null when neither is available. */
  get bus(): BroadcastBus | null {
    if (this.server) return this.server;
    const emitterBus = this.emitter.bus;
    if (emitterBus) return emitterBus;
    if (!this.warnedNoBus) {
      this.warnedNoBus = true;
      this.logger.warn('โปรเซสนี้ไม่มีทั้ง Socket.IO server และ Redis emitter — ข้ามการ push realtime');
    }
    return null;
  }

  private async authenticate(socket: Socket): Promise<void> {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) throw new Error('missing token');
    const payload = await verifyAccessToken(token);
    if (!payload) throw new Error('invalid token');
    // A suspended / deleted account must not reconnect with an access token that has not expired yet.
    const [user] = await this.db
      .select({ Id: Users.Id, RoleId: Users.RoleId, RoleCode: Roles.Code })
      .from(Users)
      .innerJoin(Roles, eq(Roles.Id, Users.RoleId))
      .where(and(eq(Users.Id, BigInt(payload.sub)), eq(Users.IsDeleted, false), eq(Users.Status, USER_STATUS.ACTIVE)))
      .limit(1);
    if (!user) throw new Error('account not active');
    socket.data.user = payload;
    // rooms follow the role's current grants, not the ones baked into the token
    const permissions = await new PermissionCheckService(this.db).roleGrants(user.RoleId, user.RoleCode as RoleCode);
    socket.data.access = { roleCode: user.RoleCode, permissions };
  }
}

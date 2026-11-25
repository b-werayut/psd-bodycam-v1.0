import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AuthUser } from '../../common/auth/auth-user';
import { PermissionCheckService } from '../../common/auth/permission-check.service';
import type { RoleCode } from '../../common/auth/permission-catalog';
import { AppException } from '../../common/errors/app-exception';
import { SettingsService } from '../../common/settings/settings.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Devices, Roles, StreamingSessions as Sessions, Users } from '../../db/schema';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { LiveStreamProvider } from './live-stream.provider';
import { looksLikePlaylist, rewritePlaylist } from './hls-rewrite';
import { openUrl, sealUrl, streamUrlKey } from './url-seal';

type SessionRow = typeof Sessions.$inferSelect;
const OPEN = [1, 2];
const gone = () => new AppException(404, 'STREAM_NOT_FOUND', 'จอภาพนี้ปิดหรือหมดอายุแล้ว');

@Injectable()
export class StreamingService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(StreamingService.name);
  private readonly key = streamUrlKey();
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly settings: SettingsService,
    private readonly permissions: PermissionCheckService,
    private readonly provider: LiveStreamProvider,
    private readonly realtime: RealtimeGateway,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => { void this.expireIdle().catch(() => this.logger.warn('เก็บจอภาพหมดอายุไม่สำเร็จ')); }, 30_000);
    this.timer.unref();
  }
  onModuleDestroy(): void { clearInterval(this.timer); }

  private notify(row: SessionRow): void {
    try { this.realtime.bus?.to(`user:${row.UserId}`).emit('stream:status', { sessionToken: row.SessionToken, deviceId: String(row.DeviceId), status: row.Status, endReason: row.EndReason }); }
    catch { this.logger.warn('ส่งสถานะจอภาพผ่าน realtime ไม่สำเร็จ'); }
  }

  /** Media bearer tickets are checked against the current account/grants on every fetch. */
  private async currentAccess(userId: bigint): Promise<boolean> {
    const [user] = await this.db.select({ roleId: Users.RoleId, roleCode: Roles.Code })
      .from(Users).innerJoin(Roles, eq(Roles.Id, Users.RoleId))
      .where(and(eq(Users.Id, userId), eq(Users.Status, 1), eq(Users.IsDeleted, false)));
    if (!user || user.roleCode === 'TEAM_LEADER') return false; // mobile scope arrives with its assignment API
    const grants = await this.permissions.roleGrants(user.roleId, user.roleCode as RoleCode);
    return grants.includes('streaming:view-live');
  }

  async startLive(user: AuthUser, deviceCode: string, channel = 1) {
    if (!await this.settings.getBool('streaming.enabled')) throw new AppException(403, 'STREAMING_DISABLED', 'ระบบปิดการดูภาพสดไว้');
    if (!await this.currentAccess(user.id)) throw new AppException(403, 'FORBIDDEN', 'ไม่มีสิทธิ์ดูภาพสด');
    const [device] = await this.db.select().from(Devices).where(and(eq(Devices.DeviceCode, deviceCode), eq(Devices.IsDeleted, false)));
    if (!device) throw new AppException(404, 'DEVICE_NOT_FOUND', 'ไม่พบกล้อง');
    if (!device.StreamingEnabled || device.Status === 4) throw new AppException(403, 'DEVICE_STREAM_DISABLED', 'กล้องนี้ไม่อนุญาตให้ดูภาพสด');
    const limit = await this.settings.getInt('streaming.max-concurrent-per-user');
    await this.expireIdle();
    // One lock per viewer, shared by every API replica. Vendor I/O is outside the transaction.
    const reserved = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`bwc-stream:${user.id}`}, 0))`);
      const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(Sessions).where(and(eq(Sessions.UserId, user.id), inArray(Sessions.Status, OPEN)));
      if (count.n >= limit) throw new AppException(429, 'STREAM_QUOTA_EXCEEDED', `เปิดดูพร้อมกันได้ไม่เกิน ${limit} จอ`, { limit });
      const [row] = await tx.insert(Sessions).values({ DeviceId: device.Id, UserId: user.id, Channel: channel, SessionToken: randomBytes(32).toString('base64url'), Protocol: 1 }).returning();
      return row;
    });
    try {
      const ticket = await this.provider.requestLive(device.VendorDeviceId, channel);
      const [active] = await this.db.update(Sessions).set({ Status: 2, VendorSessionId: ticket.vendorSessionId, StartedAt: new Date(), LastAccessAt: new Date() })
        .where(and(eq(Sessions.Id, reserved.Id), eq(Sessions.Status, 1))).returning();
      if (!active) throw gone();
      this.notify(active);
      return { sessionToken: active.SessionToken, protocol: 1, device: { id: String(device.Id), deviceCode: device.DeviceCode, deviceName: device.Name }, channel,
        playbackUrl: this.proxyUrl(active.SessionToken, ticket.vendorUrl, true), idleTimeoutSeconds: await this.settings.getInt('streaming.url-ttl-seconds') };
    } catch (error) {
      await this.db.update(Sessions).set({ Status: 4, EndedAt: new Date(), EndReason: 3, ErrorMessage: 'DSS ไม่สามารถเปิดภาพสดได้' })
        .where(and(eq(Sessions.Id, reserved.Id), eq(Sessions.Status, 1)));
      if (error instanceof AppException) throw error;
      // Vendor payloads and URLs may contain credentials; do not include them in logs or responses.
      this.logger.warn('DSS เปิดภาพสดไม่สำเร็จ');
      throw new AppException(502, 'STREAM_START_FAILED', 'ขอภาพสดจาก DSS ไม่สำเร็จ กรุณาลองอีกครั้ง');
    }
  }

  async mySessions(user: AuthUser) {
    await this.expireIdle();
    const rows = await this.db.select().from(Sessions).where(and(eq(Sessions.UserId, user.id), inArray(Sessions.Status, OPEN)));
    return { data: rows.map((r) => ({ sessionToken: r.SessionToken, deviceId: String(r.DeviceId), channel: r.Channel, protocol: 1, status: r.Status, requestedAt: r.RequestedAt, startedAt: r.StartedAt, lastAccessAt: r.LastAccessAt, endedAt: r.EndedAt, durationSeconds: r.DurationSeconds, endReason: r.EndReason, errorMessage: r.ErrorMessage })), limit: await this.settings.getInt('streaming.max-concurrent-per-user') };
  }

  async stop(user: AuthUser, token: string) {
    const [row] = await this.db.select().from(Sessions).where(and(eq(Sessions.SessionToken, token), eq(Sessions.UserId, user.id)));
    if (!row) throw gone();
    await this.end(row, 1);
    return { success: true };
  }

  private async end(row: SessionRow, reason: number) {
    const [ended] = await this.db.update(Sessions).set({ Status: 3, EndReason: reason, EndedAt: new Date(), DurationSeconds: row.StartedAt ? Math.max(0, Math.floor((Date.now() - row.StartedAt.getTime()) / 1000)) : 0 })
      .where(and(eq(Sessions.Id, row.Id), inArray(Sessions.Status, OPEN))).returning();
    if (ended) this.notify(ended);
  }

  async expireIdle(): Promise<void> {
    const seconds = await this.settings.getInt('streaming.url-ttl-seconds');
    const expired = await this.db.update(Sessions).set({ Status: 3, EndReason: 2, EndedAt: new Date(), DurationSeconds: sql`greatest(0, extract(epoch from (now() - coalesce(${Sessions.StartedAt}, ${Sessions.RequestedAt})))::int)` })
      .where(and(inArray(Sessions.Status, OPEN), sql`coalesce(${Sessions.LastAccessAt}, ${Sessions.StartedAt}, ${Sessions.RequestedAt}) < now() - ${seconds} * interval '1 second'`)).returning();
    for (const row of expired) this.notify(row);
  }

  private proxyUrl(token: string, url: string, playlist = false) {
    this.provider.assertAllowed(url);
    return `/api/streams/${token}/${playlist ? 'playlist.m3u8' : 'segment'}?s=${sealUrl(url, this.key, token)}`;
  }

  async media(token: string, sealed: string, range?: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !sealed || sealed.length > 8192) throw gone();
    const [row] = await this.db.select().from(Sessions).where(and(eq(Sessions.SessionToken, token), eq(Sessions.Status, 2)));
    if (!row) throw gone();
    const seconds = await this.settings.getInt('streaming.url-ttl-seconds');
    if (Date.now() - (row.LastAccessAt ?? row.StartedAt ?? row.RequestedAt).getTime() > seconds * 1000) { await this.end(row, 2); throw gone(); }
    const [device] = await this.db.select({ enabled: Devices.StreamingEnabled, status: Devices.Status, deleted: Devices.IsDeleted }).from(Devices).where(eq(Devices.Id, row.DeviceId));
    if (!device || device.deleted || !device.enabled || device.status === 4 || !await this.settings.getBool('streaming.enabled') || !await this.currentAccess(row.UserId)) {
      await this.end(row, 4); throw gone();
    }
    let url: string;
    try { url = openUrl(sealed, this.key, token); this.provider.assertAllowed(url); } catch { throw gone(); }
    try {
      const media = await this.provider.fetchMedia(url, range);
      // Stop can arrive during vendor I/O. Never renew or deliver a revoked ticket.
      const [touched] = await this.db.update(Sessions).set({ LastAccessAt: new Date() }).where(and(eq(Sessions.Id, row.Id), eq(Sessions.Status, 2))).returning({ id: Sessions.Id });
      if (!touched) throw gone();
      const text = media.body.subarray(0, 1024).toString('utf8');
      if (looksLikePlaylist(media.contentType, text)) {
        return { ...media, status: 200, contentRange: null, contentType: 'application/vnd.apple.mpegurl', body: Buffer.from(rewritePlaylist(media.body.toString('utf8'), { baseUrl: media.url, toProxyUrl: (absolute) => this.proxyUrl(token, absolute) })) };
      }
      return { ...media, contentType: media.contentType === 'application/octet-stream' && /\.ts(?:\?|$)/i.test(media.url) ? 'video/mp2t' : media.contentType };
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw new AppException(502, 'STREAM_MEDIA_FAILED', 'DSS ยังไม่มีภาพสด กรุณาลองใหม่');
    }
  }
}

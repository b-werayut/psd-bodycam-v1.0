import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { promises as fs } from 'node:fs';
import type { AuthUser } from '../../common/auth/auth-user';
import { PermissionCheckService } from '../../common/auth/permission-check.service';
import type { RoleCode } from '../../common/auth/permission-catalog';
import { AppException } from '../../common/errors/app-exception';
import type { EvidenceExportJob } from '../../common/queue/queue.constants';
import { EVIDENCE_EXPORT_QUEUE } from '../../common/queue/queue.module';
import { SettingsService } from '../../common/settings/settings.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Devices, EvidenceExports, Roles, Users } from '../../db/schema';
import { streamUrlKey } from '../streaming/url-seal';
import { openDownloadTicket, sealDownloadTicket } from './download-ticket';
import { EVIDENCE_EXPORT_STATUS, assertExportRange, isReusableExport } from './evidence-export-rules';
import { evidenceStorage } from './evidence-storage';

type ExportRow = typeof EvidenceExports.$inferSelect;

export type EvidenceExportView = {
  id: string;
  status: number;
  progress: number;
  fileName: string | null;
  fileSizeBytes: string | null;
  startAt: string;
  endAt: string;
  expiresAt: string | null;
  errorMessage: string | null;
};

const notFound = () => new AppException(404, 'EXPORT_NOT_FOUND', 'ไม่พบรายการดาวน์โหลด หรือลิงก์หมดอายุแล้ว');
const expired = () => new AppException(404, 'EXPORT_EXPIRED', 'ไฟล์หมดอายุแล้ว กรุณาขอดาวน์โหลดใหม่');
const notReady = () => new AppException(404, 'EXPORT_NOT_READY', 'ไฟล์ยังไม่พร้อมดาวน์โหลด');

function toView(row: ExportRow): EvidenceExportView {
  return {
    id: String(row.Id),
    status: row.Status,
    progress: row.Progress,
    fileName: row.FileName,
    fileSizeBytes: row.FileSizeBytes === null ? null : String(row.FileSizeBytes),
    startAt: row.StartAt.toISOString(),
    endAt: row.EndAt.toISOString(),
    expiresAt: row.ExpiresAt ? row.ExpiresAt.toISOString() : null,
    errorMessage: row.ErrorMessage,
  };
}

@Injectable()
export class EvidenceExportService {
  private readonly logger = new Logger(EvidenceExportService.name);
  private readonly key = streamUrlKey();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(EVIDENCE_EXPORT_QUEUE) private readonly queue: Queue<EvidenceExportJob> | null,
    private readonly settings: SettingsService,
    private readonly permissions: PermissionCheckService,
  ) {}

  async policy(): Promise<{ maxMinutes: number }> {
    return { maxMinutes: await this.settings.getInt('streaming.download-max-minutes') };
  }

  async request(
    user: AuthUser,
    input: { deviceCode: string; startAt: string; endAt: string; channel?: 1 },
  ): Promise<EvidenceExportView> {
    const channel = input.channel ?? 1;
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    assertExportRange(startAt, endAt, await this.settings.getInt('streaming.download-max-minutes'));
    if (!(await this.settings.getBool('streaming.enabled'))) {
      throw new AppException(403, 'STREAMING_DISABLED', 'ระบบปิดการดูวิดีโอไว้');
    }
    const [device] = await this.db
      .select({ id: Devices.Id, streamingEnabled: Devices.StreamingEnabled })
      .from(Devices)
      .where(and(eq(Devices.DeviceCode, input.deviceCode), eq(Devices.IsDeleted, false)));
    if (!device) throw new AppException(404, 'DEVICE_NOT_FOUND', 'ไม่พบกล้อง');
    // Retired cameras keep their recordings on the platform, so only the per-device switch blocks export.
    if (!device.streamingEnabled) {
      throw new AppException(403, 'DEVICE_STREAM_DISABLED', 'กล้องนี้ไม่อนุญาตให้ดูภาพ');
    }

    const lockKey = `evidence-export:${device.id}:${channel}:${startAt.toISOString()}:${endAt.toISOString()}`;
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      const candidates = await tx
        .select()
        .from(EvidenceExports)
        .where(
          and(
            eq(EvidenceExports.DeviceId, device.id),
            eq(EvidenceExports.Channel, channel),
            eq(EvidenceExports.StartAt, startAt),
            eq(EvidenceExports.EndAt, endAt),
            inArray(EvidenceExports.Status, [
              EVIDENCE_EXPORT_STATUS.QUEUED,
              EVIDENCE_EXPORT_STATUS.PROCESSING,
              EVIDENCE_EXPORT_STATUS.READY,
            ]),
          ),
        )
        .orderBy(desc(EvidenceExports.Id));
      const reusable = candidates.find((c) => isReusableExport(c));
      if (reusable) return reusable;
      const [created] = await tx
        .insert(EvidenceExports)
        .values({ DeviceId: device.id, Channel: channel, StartAt: startAt, EndAt: endAt, RequestedBy: user.id })
        .returning();
      return created;
    });

    // After commit. Adding an existing job id is a BullMQ no-op, so a repeat request is harmless.
    // If the queue is unreachable the Queued row stays and is re-enqueued by the worker on start.
    if (row.Status === EVIDENCE_EXPORT_STATUS.QUEUED) await this.enqueue(row.Id);
    return toView(row);
  }

  private async enqueue(id: bigint): Promise<void> {
    try {
      if (!this.queue) throw new Error('queue not configured (REDIS_URL missing)');
      await this.queue.add('export', { exportId: String(id) }, { jobId: `evidence-export-${id}` });
    } catch (error) {
      this.logger.warn(`Failed to enqueue evidence export ${id}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  async get(_user: AuthUser, id: bigint): Promise<EvidenceExportView> {
    const [row] = await this.db.select().from(EvidenceExports).where(eq(EvidenceExports.Id, id));
    if (!row) throw notFound();
    return toView(row);
  }

  async issueTicket(user: AuthUser, id: bigint): Promise<{ url: string; fileName: string }> {
    const [row] = await this.db.select().from(EvidenceExports).where(eq(EvidenceExports.Id, id));
    if (!row) throw notFound();
    const file = await this.readyFile(row);
    const ticket = sealDownloadTicket({ exportId: row.Id, userId: user.id }, this.key);
    return { url: `/api/evidence-exports/download?ticket=${encodeURIComponent(ticket)}`, fileName: file.fileName };
  }

  async openDownload(ticket: string): Promise<{ absolutePath: string; fileName: string; size: number }> {
    const opened = ticket.length > 2048 ? null : openDownloadTicket(ticket, this.key);
    if (!opened) throw notFound();
    if (!(await this.canDownload(opened.userId))) {
      throw new AppException(403, 'FORBIDDEN', 'ไม่มีสิทธิ์ดาวน์โหลดวิดีโอ');
    }
    const [row] = await this.db.select().from(EvidenceExports).where(eq(EvidenceExports.Id, opened.exportId));
    if (!row) throw notFound();
    return this.readyFile(row);
  }

  /** Ready + unexpired + file on disk, else 404. */
  private async readyFile(row: ExportRow): Promise<{ absolutePath: string; fileName: string; size: number }> {
    if (row.Status === EVIDENCE_EXPORT_STATUS.EXPIRED) throw expired();
    if (row.Status !== EVIDENCE_EXPORT_STATUS.READY || !row.FilePath || !row.FileName) throw notReady();
    if (!row.ExpiresAt || row.ExpiresAt.getTime() <= Date.now()) throw expired();
    try {
      const absolutePath = evidenceStorage().absolute(row.FilePath);
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile()) throw new Error('not a file');
      return { absolutePath, fileName: row.FileName, size: stat.size };
    } catch {
      this.logger.warn(`Evidence export ${row.Id} is Ready but its file is missing or unreadable`);
      throw notReady();
    }
  }

  /** Fresh check at open time: account still active and the role still carries evidence:download. */
  private async canDownload(userId: bigint): Promise<boolean> {
    const [user] = await this.db
      .select({ roleId: Users.RoleId, roleCode: Roles.Code })
      .from(Users)
      .innerJoin(Roles, eq(Roles.Id, Users.RoleId))
      .where(and(eq(Users.Id, userId), eq(Users.Status, 1), eq(Users.IsDeleted, false)));
    if (!user) return false;
    const grants = await this.permissions.roleGrants(user.roleId, user.roleCode as RoleCode);
    return grants.includes('evidence:download');
  }
}

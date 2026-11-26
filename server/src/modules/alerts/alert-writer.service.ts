import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Alerts, Roles, Users } from '../../db/schema';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { userRoom } from '../realtime/realtime-rooms';
import { ALERT_STATUS, type AlertType } from './alert-types';

export type RaiseAlertInput = {
  alertType: AlertType;
  severity: 1 | 2 | 3;
  deviceId?: bigint;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  dedupeKey: string;
};

/** `alert:new` payload (ids as strings, like every JSON id). */
export type AlertNewEvent = {
  alertId: string;
  alertType: number;
  severity: number;
  title: string;
  message: string;
  deviceId: string | null;
  occurredAt: string;
};

/**
 * Writes Alerts. One open alert per DedupeKey (`UQ_Alerts_OpenDedupe`). Call it after the caller's
 * transaction commits: the push goes out at once. P1 alerts are SUPER_ADMIN-only (alert 13), so the push goes
 * to each active SUPER_ADMIN's `user:{id}` room; the `alerts` room and Notifications come with P2.
 */
@Injectable()
export class AlertWriterService {
  private readonly logger = new Logger(AlertWriterService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** null = an open alert with this key already exists (nothing written, nothing pushed). */
  async raise(input: RaiseAlertInput): Promise<bigint | null> {
    const [row] = await this.db
      .insert(Alerts)
      .values({
        AlertType: input.alertType,
        Severity: input.severity,
        Status: ALERT_STATUS.NEW,
        DeviceId: input.deviceId ?? null,
        Title: input.title,
        Message: input.message,
        Data: input.data ?? null,
        DedupeKey: input.dedupeKey,
      })
      .onConflictDoNothing({ target: Alerts.DedupeKey, where: sql`${Alerts.Status} in (1, 2)` })
      .returning({ id: Alerts.Id, occurredAt: Alerts.OccurredAt });
    if (!row) return null;

    await this.pushToAdmins({
      alertId: String(row.id),
      alertType: input.alertType,
      severity: input.severity,
      title: input.title,
      message: input.message,
      deviceId: input.deviceId === undefined ? null : String(input.deviceId),
      occurredAt: row.occurredAt.toISOString(),
    });
    return row.id;
  }

  /** Resolves the open alert of this key (system resolve); returns how many rows changed. */
  async resolve(dedupeKey: string): Promise<number> {
    const rows = await this.db
      .update(Alerts)
      .set({ Status: ALERT_STATUS.RESOLVED, ResolvedAt: sql`now()` })
      .where(and(eq(Alerts.DedupeKey, dedupeKey), inArray(Alerts.Status, [ALERT_STATUS.NEW, ALERT_STATUS.ACKNOWLEDGED])))
      .returning({ id: Alerts.Id });
    return rows.length;
  }

  private async pushToAdmins(event: AlertNewEvent): Promise<void> {
    const bus = this.realtime.bus;
    if (!bus) return;
    try {
      const admins = await this.db
        .select({ id: Users.Id })
        .from(Users)
        .innerJoin(Roles, eq(Roles.Id, Users.RoleId))
        .where(and(eq(Roles.Code, 'SUPER_ADMIN'), eq(Users.Status, 1), eq(Users.IsDeleted, false)));
      for (const admin of admins) bus.to(userRoom(admin.id)).emit('alert:new', event);
    } catch (error) {
      // the alert is in the DB either way; a lost push only delays what the screen shows
      this.logger.warn(`Failed to push alert:new: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

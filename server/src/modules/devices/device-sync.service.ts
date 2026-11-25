import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { DSS_CLIENT, type DssClient } from '../../common/dss/dss-client';
import { RedisLockService } from '../../common/lock/redis-lock.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Devices, DeviceState } from '../../db/schema';
import { ALERT_SEVERITY, ALERT_TYPE, vendorMissingDedupeKey } from '../alerts/alert-types';
import { AlertWriterService } from '../alerts/alert-writer.service';
import { planDeviceSync } from './device-sync.plan';

export type DeviceSyncResult = {
  created: number;
  updated: number;
  /** newly missing this run */
  missing: number;
  reappeared: number;
  skipped: number;
  vendorTotal: number;
  complete: boolean;
};

const LOCK_KEY = 'device:sync';
const LOCK_TTL_SECONDS = 600;
const DEVICE_KIND_PRIMARY = 1;

/**
 * The only writer of `Devices` (DL53): DSS device list → create / fill / mark missing. Never deletes.
 * A new camera gets its `DeviceState` row in the same transaction. Only a complete list may mark a
 * camera missing (a paged list would mark every camera on later pages).
 */
@Injectable()
export class DeviceSyncService {
  private readonly logger = new Logger(DeviceSyncService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(DSS_CLIENT) private readonly dss: DssClient,
    private readonly lock: RedisLockService,
    private readonly alerts: AlertWriterService,
  ) {}

  /** null = another instance holds the lock (or Redis is down). Throws when DSS fails. */
  syncOnce(): Promise<DeviceSyncResult | null> {
    return this.lock.withLock(LOCK_KEY, LOCK_TTL_SECONDS, () => this.run());
  }

  private async run(): Promise<DeviceSyncResult> {
    const inventory = await this.dss.listDevices();

    const outcome = await this.db.transaction(async (tx) => {
      const local = await tx
        .select({
          id: Devices.Id,
          deviceCode: Devices.DeviceCode,
          vendorDeviceId: Devices.VendorDeviceId,
          name: Devices.Name,
          serialNo: Devices.SerialNo,
          model: Devices.Model,
          isDeleted: Devices.IsDeleted,
          vendorMissingSince: Devices.VendorMissingSince,
        })
        .from(Devices)
        .orderBy(asc(Devices.Id));
      const plan = planDeviceSync(inventory.devices, local);
      // an "empty but complete" list while we know cameras is a DSS glitch, never "every camera is gone"
      const complete = inventory.complete && !(inventory.devices.length === 0 && local.some((row) => !row.isDeleted));
      if (inventory.complete && !complete) {
        this.logger.warn('DSS ส่งรายการอุปกรณ์ว่างทั้งที่ระบบมีกล้องอยู่ — ไม่ตั้งกล้องใดเป็นหายในรอบนี้');
      }

      for (const create of plan.creates) {
        const [row] = await tx
          .insert(Devices)
          .values({
            DeviceCode: create.deviceCode,
            VendorDeviceId: create.vendorDeviceId,
            Name: create.name,
            SerialNo: create.serialNo,
            Model: create.model,
            Kind: DEVICE_KIND_PRIMARY,
            VendorSeenAt: sql`now()`,
          })
          .returning({ id: Devices.Id });
        await tx.insert(DeviceState).values({ DeviceId: row.id });
      }
      for (const update of plan.updates) {
        await tx
          .update(Devices)
          .set({ ...update.patch, UpdatedAt: sql`now()` })
          .where(eq(Devices.Id, update.id));
      }

      let reappeared: { id: bigint }[] = [];
      if (plan.seenIds.length > 0) {
        reappeared = await tx
          .update(Devices)
          .set({ VendorMissingSince: null })
          .where(and(inArray(Devices.Id, plan.seenIds), isNotNull(Devices.VendorMissingSince)))
          .returning({ id: Devices.Id });
        await tx.update(Devices).set({ VendorSeenAt: sql`now()` }).where(inArray(Devices.Id, plan.seenIds));
      }

      let newlyMissing: { id: bigint; deviceCode: string }[] = [];
      if (complete && plan.missingAtVendor.length > 0) {
        newlyMissing = await tx
          .update(Devices)
          .set({ VendorMissingSince: sql`now()` })
          .where(
            and(
              inArray(
                Devices.Id,
                plan.missingAtVendor.map((m) => m.id),
              ),
              isNull(Devices.VendorMissingSince),
            ),
          )
          .returning({ id: Devices.Id, deviceCode: Devices.DeviceCode });
      }
      return { plan, reappeared, newlyMissing, complete };
    });

    // after commit: bring alert 13 in line with VendorMissingSince (also repairs a run that died between the
    // commit and the alert writes)
    await this.reconcileAlerts();

    const { plan } = outcome;
    if (plan.skips.length > 0) {
      const sample = plan.skips.slice(0, 5).map((s) => `${s.vendorDeviceId}: ${s.message}`);
      this.logger.warn(`DeviceSync ข้าม ${plan.skips.length} รายการ — ${sample.join(' | ')}`);
    }
    const result: DeviceSyncResult = {
      created: plan.creates.length,
      updated: plan.updates.length,
      missing: outcome.newlyMissing.length,
      reappeared: outcome.reappeared.length,
      skipped: plan.skips.length,
      vendorTotal: inventory.devices.length,
      complete: outcome.complete,
    };
    this.logger.log(`DeviceSync: ${JSON.stringify(result)}`);
    return result;
  }

  /**
   * Every missing camera has had an alert 13 since it went missing (an SUPER_ADMIN's dismiss counts — not raised
   * again); every open alert 13 of a camera that is no longer missing is resolved. Idempotent.
   */
  private async reconcileAlerts(): Promise<void> {
    const missing = await this.db.execute<{ id: string; code: string }>(sql`
      select d."Id"::text as id, d."DeviceCode" as code from "Devices" d
      where d."IsDeleted" = false and d."VendorMissingSince" is not null
        and not exists (
          select 1 from "Alerts" a
          where a."DeviceId" = d."Id" and a."AlertType" = ${ALERT_TYPE.DEVICE_VENDOR_MISSING}
            and a."OccurredAt" >= d."VendorMissingSince")
      order by d."Id"`);
    for (const device of missing) {
      try {
        await this.alerts.raise({
          alertType: ALERT_TYPE.DEVICE_VENDOR_MISSING,
          severity: ALERT_SEVERITY.WARNING,
          deviceId: BigInt(device.id),
          title: `กล้อง ${device.code} หายจากรายการอุปกรณ์ของ DSS`,
          message: 'ตรวจรอบล่าสุดไม่พบกล้องนี้ในรายการอุปกรณ์ — ระบบไม่ลบกล้อง กรุณาตรวจที่ DSS',
          dedupeKey: vendorMissingDedupeKey(device.id),
        });
      } catch (error) {
        this.logger.error(`เขียน alert กล้อง ${device.code} หายไม่สำเร็จ (ลองใหม่รอบถัดไป): ${String(error)}`);
      }
    }

    const back = await this.db.execute<{ key: string }>(sql`
      select a."DedupeKey" as key from "Alerts" a join "Devices" d on d."Id" = a."DeviceId"
      where a."AlertType" = ${ALERT_TYPE.DEVICE_VENDOR_MISSING} and a."Status" in (1, 2)
        and (d."VendorMissingSince" is null or d."IsDeleted" = true)
      order by a."Id"`);
    for (const alert of back) await this.alerts.resolve(alert.key);
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { likePattern } from '../../common/http/page-query.dto';
import { paged, type Paged } from '../../common/http/paged';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Devices, DeviceState } from '../../db/schema';
import { DeviceStatusDisplayService } from './device-status-display.service';
import { toDeviceView, type DeviceView } from './devices.mapper';
import type { QueryDevicesDto } from './dto/query-devices.dto';

/**
 * Camera list (read-only — Devices are written only by DeviceSync, DL53). A few hundred cameras at most,
 * so the computed-status filter and paging run in memory after one status lookup.
 */
@Injectable()
export class DevicesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly display: DeviceStatusDisplayService,
  ) {}

  async list(query: QueryDevicesDto): Promise<Paged<DeviceView>> {
    const where: SQL[] = [eq(Devices.IsDeleted, false)];
    if (query.status !== undefined) where.push(eq(Devices.Status, query.status));
    if (query.kind !== undefined) where.push(eq(Devices.Kind, query.kind));
    const q = query.q?.trim();
    if (q) {
      const pattern = likePattern(q);
      where.push(
        or(ilike(Devices.DeviceCode, pattern), ilike(Devices.VendorDeviceId, pattern), ilike(Devices.Name, pattern))!,
      );
    }

    const rows = await this.db
      .select({
        id: Devices.Id,
        deviceCode: Devices.DeviceCode,
        vendorDeviceId: Devices.VendorDeviceId,
        name: Devices.Name,
        model: Devices.Model,
        serialNo: Devices.SerialNo,
        kind: Devices.Kind,
        status: Devices.Status,
        streamingEnabled: Devices.StreamingEnabled,
        vendorMissingSince: Devices.VendorMissingSince,
        lastFixAt: DeviceState.LastFixAt,
        lastLat: DeviceState.LastLat,
        lastLng: DeviceState.LastLng,
      })
      .from(Devices)
      .leftJoin(DeviceState, eq(DeviceState.DeviceId, Devices.Id))
      .where(and(...where))
      .orderBy(asc(Devices.DeviceCode), asc(Devices.Id));

    const statuses = await this.display.statuses(rows);
    let views = rows.map((row) => toDeviceView(row, statuses.get(String(row.id))));
    if (query.online) views = views.filter((v) => v.platformState === query.online);

    const start = (query.page - 1) * query.pageSize;
    return paged(views.slice(start, start + query.pageSize), views.length, query.page, query.pageSize);
  }
}

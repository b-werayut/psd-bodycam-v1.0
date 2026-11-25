import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, lte, ne } from 'drizzle-orm';
import { AppException } from '../../common/errors/app-exception';
import { SettingsService } from '../../common/settings/settings.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { GpsLocations } from '../../db/schema.partitioned';
import { Devices, DeviceState } from '../../db/schema';
import { DeviceStatusDisplayService } from '../devices/device-status-display.service';
import { fixMaxAgeSeconds } from './fix-freshness';
import { buildRoute, toRouteJson, type RouteRules } from './route-builder';

/** Raw points read per request; a normal 24 h is ~6,000 points at 15 s, so this only guards bad data. */
export const ROUTE_READ_CAP = 50_000;

const DEVICE_RETIRED = 4;

export type PositionView = {
  deviceId: string;
  deviceCode: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
  speedKph: number | null;
  heading: number | null;
  lastFixAt: string | null;
  fixValid: boolean | null;
  platformState: 'online' | 'offline' | 'unknown';
  platformStatusFetchedAt: string | null;
};

@Injectable()
export class TrackingReadService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly settings: SettingsService,
    private readonly display: DeviceStatusDisplayService,
  ) {}

  /** Live map snapshot: every camera that is not deleted or retired; then `gps:batch` keeps it moving. */
  async positions(): Promise<{ data: PositionView[]; total: number; fixActiveSeconds: number }> {
    const rows = await this.db
      .select({
        id: Devices.Id,
        vendorDeviceId: Devices.VendorDeviceId,
        deviceCode: Devices.DeviceCode,
        name: Devices.Name,
        lat: DeviceState.LastLat,
        lng: DeviceState.LastLng,
        speedKph: DeviceState.LastSpeedKph,
        heading: DeviceState.LastHeading,
        lastFixAt: DeviceState.LastFixAt,
        fixValid: DeviceState.LastFixValid,
      })
      .from(Devices)
      .leftJoin(DeviceState, eq(DeviceState.DeviceId, Devices.Id))
      .where(and(eq(Devices.IsDeleted, false), ne(Devices.Status, DEVICE_RETIRED)))
      .orderBy(asc(Devices.DeviceCode), asc(Devices.Id));
    const statuses = await this.display.statuses(rows);

    const data = rows.map((row) => {
      const status = statuses.get(String(row.id));
      return {
        deviceId: String(row.id),
        deviceCode: row.deviceCode,
        name: row.name,
        lat: row.lat,
        lng: row.lng,
        speedKph: row.speedKph,
        heading: row.heading,
        lastFixAt: row.lastFixAt?.toISOString() ?? null,
        fixValid: row.fixValid,
        platformState: status?.platformState ?? 'unknown',
        platformStatusFetchedAt: status?.platformStatusFetchedAt ?? null,
      };
    });
    return { data, total: data.length, fixActiveSeconds: await this.fixActiveSeconds() };
  }

  /** Route of one camera over ≤ 36 h (HISTORY_MAX_RANGE_HOURS), valid points only (raw rows stay; suspects are counted). */
  async deviceHistory(deviceId: bigint, from: Date, to: Date, readCap = ROUTE_READ_CAP) {
    const [device] = await this.db
      .select({ id: Devices.Id, code: Devices.DeviceCode, name: Devices.Name })
      .from(Devices)
      .where(and(eq(Devices.Id, deviceId), eq(Devices.IsDeleted, false)))
      .limit(1);
    if (!device) throw new AppException(404, 'NOT_FOUND', `ไม่พบกล้อง id ${deviceId}`);

    const rows = await this.db
      .select({
        at: GpsLocations.RecordedAt,
        lat: GpsLocations.Lat,
        lng: GpsLocations.Lng,
        valid: GpsLocations.IsValidFix,
      })
      .from(GpsLocations)
      .where(and(eq(GpsLocations.DeviceId, deviceId), gte(GpsLocations.RecordedAt, from), lte(GpsLocations.RecordedAt, to)))
      .orderBy(asc(GpsLocations.RecordedAt))
      .limit(readCap + 1);
    const truncated = rows.length > readCap;
    const used = truncated ? rows.slice(0, readCap) : rows;
    const valid = used.filter((row) => row.valid);

    const rules: RouteRules = {
      stopRadiusM: await this.settings.getInt('tracking.stop-radius-meters'),
      stopMinMinutes: await this.settings.getInt('tracking.stop-min-minutes'),
      gapSeconds: await this.fixActiveSeconds(),
    };
    const route = buildRoute(
      valid.map((row) => ({ at: row.at, lat: row.lat, lng: row.lng })),
      rules,
    );

    return {
      device: { id: String(device.id), code: device.code, name: device.name },
      from: from.toISOString(),
      to: to.toISOString(),
      rules,
      pointCount: valid.length,
      suspectCount: used.length - valid.length,
      staleStartCount: route.staleStartCount,
      spikeCount: route.spikeCount,
      smoothedCount: route.smoothedCount,
      truncated,
      ...toRouteJson(route),
    };
  }

  private async fixActiveSeconds(): Promise<number> {
    return fixMaxAgeSeconds(
      await this.settings.getInt('status.unknown-after-seconds'),
      await this.settings.getInt('gps.poll-interval-seconds'),
    );
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { haversineMeters } from '../../common/geo/haversine';
import { SettingsService } from '../../common/settings/settings.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { GpsLocations } from '../../db/schema.partitioned';
import { Depots, DeviceState } from '../../db/schema';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TRACKING_ROOM } from '../realtime/realtime-rooms';
import { fixMaxAgeSeconds, isFreshFix } from './fix-freshness';
import { confirmsStaleStartLanding, STALE_START_RULES, type RoutePoint } from './stale-start';

export type GpsFix = {
  deviceId: bigint;
  /** device time; null ⇒ now */
  recordedAt: Date | null;
  lat: number;
  lng: number;
  speedKph: number | null;
  heading?: number | null;
};

export type IngestResult = {
  received: number;
  stored: number;
  /** already stored (same DeviceId + RecordedAt), in this batch or before */
  duplicate: number;
  /** at or before the camera's last fix */
  stale: number;
  /** more than 2 minutes ahead of now */
  future: number;
  /** stored with IsValidFix = false (> 200 km/h from the last valid fix) */
  suspect: number;
  /** earlier suspect points confirmed valid (stale start at connect) */
  revalidated: number;
  /** cameras whose newest valid fix in this batch is within fixMaxAgeSeconds */
  freshDeviceIds: bigint[];
};

/** `gps:batch` payload: valid points only. */
export type GpsBatchPoint = {
  deviceId: string;
  lat: number;
  lng: number;
  speedKph: number | null;
  heading: number | null;
  recordedAt: string;
  isValidFix: true;
};

const FUTURE_TOLERANCE_MS = 2 * 60_000;
const MAX_PLAUSIBLE_SPEED_KPH = 200;
/** below this a jump is GPS jitter, never suspect */
const MIN_MOVEMENT_M = 5;
const INSERT_CHUNK = 1000;
const RECENT_FIX_LIMIT = STALE_START_RULES.maxPoints + 2;

type Anchor = { lat: number; lng: number; at: Date };
type RecentPoint = RoutePoint & { valid: boolean; pending?: { IsValidFix: boolean }; stored?: boolean };
type Latest = { deviceId: bigint; lat: number; lng: number; at: Date; speedKph: number | null; heading: number | null };

/**
 * GPS pipeline (port of the reference ingestLocations): sort → drop in-batch duplicates, future and stale
 * points → stale-start revalidation → drift filter (kept, flagged) → insert `ON CONFLICT DO NOTHING` →
 * forward-only `DeviceState` snapshot (+ `IsAtDepot`) → `gps:batch` to the `tracking` room after the writes.
 * Never calls anything outside the DB (real-time path, Part 2).
 */
@Injectable()
export class GpsIngestService {
  private readonly logger = new Logger(GpsIngestService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly settings: SettingsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async ingest(fixes: readonly GpsFix[]): Promise<IngestResult> {
    const result: IngestResult = {
      received: fixes.length,
      stored: 0,
      duplicate: 0,
      stale: 0,
      future: 0,
      suspect: 0,
      revalidated: 0,
      freshDeviceIds: [],
    };
    if (fixes.length === 0) return result;

    const now = new Date();
    const maxAgeSeconds = fixMaxAgeSeconds(
      await this.settings.getInt('status.unknown-after-seconds'),
      await this.settings.getInt('gps.poll-interval-seconds'),
    );
    const deviceIds = [...new Set(fixes.map((f) => f.deviceId))];
    const anchors = await this.lastFixes(deviceIds);
    const recent = await this.recentFixes(deviceIds);

    const rows: (typeof GpsLocations.$inferInsert)[] = [];
    const revalidate: { deviceId: bigint; at: Date }[] = [];
    const latest = new Map<bigint, Latest>();
    const seen = new Set<string>();

    const ordered = fixes
      .map((f) => ({ f, at: f.recordedAt ?? now }))
      .sort((x, y) => x.at.getTime() - y.at.getTime());

    for (const { f, at } of ordered) {
      const key = `${f.deviceId}|${at.getTime()}`;
      if (seen.has(key)) {
        result.duplicate++;
        continue;
      }
      seen.add(key);
      if (at.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
        result.future++;
        continue;
      }
      const ref = anchors.get(f.deviceId);
      if (ref && at.getTime() <= ref.at.getTime()) {
        result.stale++;
        continue;
      }

      // The anchor is the last valid point. If the previous point was flagged only because it followed a
      // stale start and this point confirms it, it was real: revalidate it and compare against it.
      const point: Anchor = { lat: f.lat, lng: f.lng, at };
      const past = recent.get(f.deviceId);
      const previous = past?.points.at(-1);
      const isNewest = !previous || previous.at.getTime() < at.getTime();
      let anchor = ref;
      if (
        past &&
        previous &&
        isNewest &&
        !previous.valid &&
        confirmsStaleStartLanding(past.points, point, maxAgeSeconds, past.complete)
      ) {
        previous.valid = true;
        if (previous.pending) {
          previous.pending.IsValidFix = true;
          result.suspect--;
        } else revalidate.push({ deviceId: f.deviceId, at: previous.at });
        result.revalidated++;
        anchor = previous;
      }

      const valid = this.isPlausible(anchor, point);
      if (!valid) result.suspect++;
      const row: typeof GpsLocations.$inferInsert = {
        DeviceId: f.deviceId,
        RecordedAt: at,
        ReceivedAt: now,
        Lat: f.lat,
        Lng: f.lng,
        SpeedKph: f.speedKph,
        Heading: f.heading ?? null,
        IsValidFix: valid,
      };
      rows.push(row);
      if (past && isNewest) past.points.push({ ...point, valid, pending: row as { IsValidFix: boolean } });

      if (valid) {
        anchors.set(f.deviceId, point);
        latest.set(f.deviceId, {
          deviceId: f.deviceId,
          lat: f.lat,
          lng: f.lng,
          at,
          speedKph: f.speedKph,
          heading: f.heading ?? null,
        });
      }
    }

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK);
      const inserted = await this.db
        .insert(GpsLocations)
        .values(chunk)
        .onConflictDoNothing({ target: [GpsLocations.DeviceId, GpsLocations.RecordedAt] })
        .returning({ deviceId: GpsLocations.DeviceId });
      result.stored += inserted.length;
      result.duplicate += chunk.length - inserted.length;
    }
    await this.markValid(revalidate);
    await this.advanceSnapshots([...latest.values()], now);

    result.freshDeviceIds = [...latest.values()].filter((l) => isFreshFix(l.at, now, maxAgeSeconds)).map((l) => l.deviceId);

    const points: GpsBatchPoint[] = rows
      .filter((row) => row.IsValidFix)
      .map((row) => ({
        deviceId: String(row.DeviceId),
        lat: row.Lat,
        lng: row.Lng,
        speedKph: row.SpeedKph ?? null,
        heading: row.Heading ?? null,
        recordedAt: (row.RecordedAt as Date).toISOString(),
        isValidFix: true,
      }));
    if (points.length > 0) this.realtime.bus?.to(TRACKING_ROOM).emit('gps:batch', { points });

    if (result.suspect > 0) this.logger.warn(`พิกัดผิดปกติ ${result.suspect} จุด (เร็วเกิน ${MAX_PLAUSIBLE_SPEED_KPH} กม./ชม.) — เก็บไว้แต่ไม่ใช้`);
    if (result.future > 0) this.logger.warn(`ตัดพิกัด ${result.future} จุดที่เวลาเกินอนาคต — นาฬิกากล้องอาจเพี้ยน`);
    return result;
  }

  private isPlausible(ref: Anchor | undefined, point: Anchor): boolean {
    if (!ref) return true;
    const seconds = (point.at.getTime() - ref.at.getTime()) / 1000;
    if (seconds <= 0) return true;
    const meters = haversineMeters(ref, point);
    if (meters < MIN_MOVEMENT_M) return true;
    return (meters / seconds) * 3.6 <= MAX_PLAUSIBLE_SPEED_KPH;
  }

  /** The last valid fix of each camera from the DeviceState snapshot. */
  private async lastFixes(deviceIds: bigint[]): Promise<Map<bigint, Anchor>> {
    const rows = await this.db
      .select({ id: DeviceState.DeviceId, at: DeviceState.LastFixAt, lat: DeviceState.LastLat, lng: DeviceState.LastLng })
      .from(DeviceState)
      .where(inArray(DeviceState.DeviceId, deviceIds));
    const out = new Map<bigint, Anchor>();
    for (const row of rows) {
      if (row.at && row.lat !== null && row.lng !== null) out.set(row.id, { at: row.at, lat: row.lat, lng: row.lng });
    }
    return out;
  }

  /** The latest RECENT_FIX_LIMIT points of each camera (old → new), one index range scan per camera. */
  private async recentFixes(deviceIds: bigint[]): Promise<Map<bigint, { points: RecentPoint[]; complete: boolean }>> {
    const out = new Map<bigint, { points: RecentPoint[]; complete: boolean }>();
    for (const id of deviceIds) out.set(id, { points: [], complete: true });
    const ids = sql.join(
      deviceIds.map((id) => sql`(${id.toString()}::bigint)`),
      sql`, `,
    );
    const rows = await this.db.execute<{ DeviceId: string; RecordedAt: string | Date; Lat: number; Lng: number; IsValidFix: boolean }>(sql`
      SELECT v.id::text AS "DeviceId", g."RecordedAt", g."Lat", g."Lng", g."IsValidFix"
      FROM (VALUES ${ids}) AS v(id)
      CROSS JOIN LATERAL (
        SELECT "RecordedAt", "Lat", "Lng", "IsValidFix" FROM "GpsLocations"
        WHERE "DeviceId" = v.id ORDER BY "RecordedAt" DESC LIMIT ${RECENT_FIX_LIMIT}
      ) AS g
      ORDER BY v.id, g."RecordedAt"`);
    for (const row of rows) {
      out.get(BigInt(row.DeviceId))?.points.push({
        at: row.RecordedAt instanceof Date ? row.RecordedAt : new Date(row.RecordedAt),
        lat: Number(row.Lat),
        lng: Number(row.Lng),
        valid: row.IsValidFix,
      });
    }
    for (const entry of out.values()) entry.complete = entry.points.length < RECENT_FIX_LIMIT;
    return out;
  }

  /** Raw rows stay; only the flag changes. */
  private async markValid(points: { deviceId: bigint; at: Date }[]): Promise<void> {
    for (const p of points) {
      await this.db
        .update(GpsLocations)
        .set({ IsValidFix: true })
        .where(and(eq(GpsLocations.DeviceId, p.deviceId), eq(GpsLocations.RecordedAt, p.at)));
    }
  }

  /** Forward-only: an older batch never moves the snapshot back. IsAtDepot from active Depots. */
  private async advanceSnapshots(latest: Latest[], now: Date): Promise<void> {
    if (latest.length === 0) return;
    const maxAgeMs = (await this.settings.getInt('depot.fix-max-age-minutes')) * 60_000;
    const depots = await this.db
      .select({ lat: Depots.Lat, lng: Depots.Lng, radiusM: Depots.RadiusM })
      .from(Depots)
      .where(and(eq(Depots.IsActive, true), eq(Depots.IsDeleted, false)));

    for (const l of latest) {
      const atDepot =
        now.getTime() - l.at.getTime() <= maxAgeMs && depots.some((d) => haversineMeters(d, l) <= d.radiusM);
      await this.db
        .update(DeviceState)
        .set({
          LastFixAt: l.at,
          LastLat: l.lat,
          LastLng: l.lng,
          LastSpeedKph: l.speedKph,
          LastHeading: l.heading,
          LastFixValid: true,
          IsAtDepot: atDepot,
          UpdatedAt: sql`now()`,
        })
        .where(
          and(
            eq(DeviceState.DeviceId, l.deviceId),
            or(isNull(DeviceState.LastFixAt), lt(DeviceState.LastFixAt, l.at)),
          ),
        );
    }
  }
}

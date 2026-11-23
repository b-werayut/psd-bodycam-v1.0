import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import { DSS_CLIENT, type DssClient } from '../../common/dss/dss-client';
import { RedisLockService } from '../../common/lock/redis-lock.service';
import { SETTING_DEFAULTS } from '../../common/settings/setting-spec';
import { SettingsService } from '../../common/settings/settings.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Devices } from '../../db/schema';
import { DeviceStatusService, type Observation } from '../device-status/device-status.service';
import { PLATFORM_STATE } from '../device-status/observation';
import { GpsIngestService, type GpsFix } from './gps-ingest.service';

export type PollResult = { devices: number; observed: number; fixes: number; failed: number; elapsedMs: number };

export type GpsPollOptions = { enabled: boolean; concurrency: number };

const LOCK_KEY = 'gps:poll';
const LOCK_TTL_SECONDS = 300;
const DEVICE_RETIRED = 4;

export function gpsPollOptions(env: Record<string, string | undefined> = process.env): GpsPollOptions {
  const enabled = !/^(false|0|no)$/i.test((env.GPS_POLL_ENABLED ?? '').trim());
  const raw = (env.GPS_POLL_CONCURRENCY ?? '').trim();
  const n = Number(raw);
  const concurrency = raw && Number.isInteger(n) ? Math.min(32, Math.max(1, n)) : 8;
  return { enabled, concurrency };
}

/** Runs `worker` over `items` with at most `size` in flight. */
export async function runPool<T>(items: readonly T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) await worker(items[cursor++]);
  });
  await Promise.all(runners);
}

/**
 * GpsPoll (worker `tracking` role): one DSS `/location` call per camera gives GPS + online/offline (DL32).
 * Every live camera, every cycle — no cap. A cycle never overlaps the previous one: the next starts
 * `gps.poll-interval-seconds` after this one ends (a slow DSS makes cycles longer, never skips cameras).
 * Never calls Booking (real-time path).
 */
@Injectable()
export class GpsPollService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(GpsPollService.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(DSS_CLIENT) private readonly dss: DssClient,
    private readonly deviceStatus: DeviceStatusService,
    private readonly ingest: GpsIngestService,
    private readonly lock: RedisLockService,
    private readonly settings: SettingsService,
  ) {}

  onApplicationBootstrap(): void {
    const options = gpsPollOptions();
    if (!options.enabled) {
      this.logger.log('GpsPoll ปิดอยู่ (GPS_POLL_ENABLED=false)');
      return;
    }
    this.logger.log(`GpsPoll เริ่มทำงาน (ถามพร้อมกัน ${options.concurrency} คำขอ)`);
    this.start();
  }

  onApplicationShutdown(): void {
    this.stop();
  }

  start(): void {
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** null = no lock (another worker polls, or Redis is down) — DSS is not called. */
  tick(): Promise<PollResult | null> {
    return this.lock.withLock(LOCK_KEY, LOCK_TTL_SECONDS, () => this.pollOnce());
  }

  private async pollOnce(): Promise<PollResult> {
    const startedAt = Date.now();
    const { concurrency } = gpsPollOptions();
    const devices = await this.db
      .select({ id: Devices.Id, vendorDeviceId: Devices.VendorDeviceId })
      .from(Devices)
      .where(and(eq(Devices.IsDeleted, false), ne(Devices.Status, DEVICE_RETIRED)))
      .orderBy(asc(Devices.Id));

    const states = new Map<bigint, boolean | null>();
    const fixes: GpsFix[] = [];
    let failed = 0;
    let firstError: string | null = null;

    await runPool(devices, concurrency, async (device) => {
      try {
        const reading = await this.dss.fetchReading(device.vendorDeviceId);
        states.set(device.id, reading.online);
        if (reading.location) {
          fixes.push({
            deviceId: device.id,
            recordedAt: reading.location.recordedAt,
            lat: reading.location.lat,
            lng: reading.location.lng,
            speedKph: reading.location.speedKph,
          });
        }
      } catch (error) {
        failed++;
        firstError ??= error instanceof Error ? error.message : String(error);
      }
    });
    if (failed > 0) this.logger.error(`ดึงพิกัด/สถานะไม่สำเร็จ ${failed}/${devices.length} กล้อง: ${firstError}`);

    const ingested = await this.ingest.ingest(fixes);
    const fresh = new Set(ingested.freshDeviceIds);
    // a fresh fix means the camera is on even when DSS did not say so
    const observations: Observation[] = [];
    for (const [deviceId, online] of states) {
      const state = online ?? (fresh.has(deviceId) ? true : null);
      if (state !== null) observations.push({ deviceId, state: state ? PLATFORM_STATE.ONLINE : PLATFORM_STATE.OFFLINE });
    }
    const { changed } = await this.deviceStatus.applyObservations(observations);

    const elapsedMs = Date.now() - startedAt;
    const result: PollResult = {
      devices: devices.length,
      observed: observations.length,
      fixes: fixes.length,
      failed,
      elapsedMs,
    };
    this.logger.log(
      `GpsPoll: ถาม ${devices.length} กล้อง | ได้สถานะ ${observations.length} | ได้พิกัด ${fixes.length} | ` +
        `บันทึก ${ingested.stored} | สถานะเปลี่ยน ${changed.length} | ผิดพลาด ${failed} | ${elapsedMs} ms`,
    );
    const intervalSeconds = await this.intervalSeconds();
    if (elapsedMs > intervalSeconds * 1000) {
      this.logger.warn(
        `รอบ GpsPoll ใช้เวลา ${Math.round(elapsedMs / 1000)} วินาที (${devices.length} กล้อง, พร้อมกัน ${concurrency}) ` +
          `นานกว่า gps.poll-interval-seconds (${intervalSeconds}) — รอบถัดไปเริ่มช้าลง ไม่มีกล้องถูกข้าม · ` +
          'แก้ด้วยการเพิ่ม GPS_POLL_CONCURRENCY หรือยืด gps.poll-interval-seconds',
      );
    }
    return result;
  }

  private async loop(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.tick();
    } catch (error) {
      this.logger.error(`รอบ GpsPoll ล้มเหลว: ${error instanceof Error ? error.message : String(error)}`);
    }
    const seconds = await this.intervalSeconds();
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.loop(), seconds * 1000);
    this.timer.unref();
  }

  private async intervalSeconds(): Promise<number> {
    try {
      return await this.settings.getInt('gps.poll-interval-seconds');
    } catch {
      return SETTING_DEFAULTS['gps.poll-interval-seconds'];
    }
  }
}

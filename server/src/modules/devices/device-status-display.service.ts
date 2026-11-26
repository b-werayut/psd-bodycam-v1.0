import { Inject, Injectable, Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { RedisClientType } from 'redis';
import { DSS_CLIENT, type DssClient, type VendorInventory } from '../../common/dss/dss-client';
import { deviceStatusCacheKey } from '../../common/redis/cache-key';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { SettingsService } from '../../common/settings/settings.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { DeviceState } from '../../db/schema';
import { displayStateOf, type DisplayState } from '../device-status/observation';

export type DisplayStatus = {
  platformState: DisplayState;
  /** when DSS said so; null = DSS could not be asked (status computed from DeviceState) */
  platformStatusFetchedAt: string | null;
};

type CachedValue = { s: DisplayState; at: string | null };

/** DSS failed moments ago: skip it until the cache window ends instead of waiting on its timeout again. */
class DssRecentlyFailed extends Error {}

/**
 * Camera status for screens (DL35, DL45): from DSS when a screen opens, not pushed. One DSS device-list
 * call answers every camera; each answer is cached in Redis `device-status:{deviceId}` for
 * `status.display-cache-seconds`. Redis down ⇒ ask DSS (fail-open). DSS down ⇒ compute from
 * `DeviceState` with `platformStatusFetchedAt: null`. Separate from the session engine's DeviceState.
 */
@Injectable()
export class DeviceStatusDisplayService {
  private readonly logger = new Logger(DeviceStatusDisplayService.name);
  /** one DSS list call per process at a time, however many screens open together */
  private inflight: Promise<VendorInventory> | null = null;
  /** after a failure, DSS is not asked again before this time (ms) */
  private failedUntil = 0;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType | null,
    @Inject(DSS_CLIENT) private readonly dss: DssClient,
    private readonly settings: SettingsService,
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
  ) {}

  /** Keyed by the device id as a string. */
  async statuses(devices: readonly { id: bigint; vendorDeviceId: string }[]): Promise<Map<string, DisplayStatus>> {
    const out = new Map<string, DisplayStatus>();
    if (devices.length === 0) return out;
    const ttl = await this.settings.getInt('status.display-cache-seconds');

    const cached = ttl > 0 ? await this.readCache(devices) : new Map<string, DisplayStatus>();
    for (const [id, status] of cached) out.set(id, status);
    const missing = devices.filter((d) => !out.has(String(d.id)));
    if (missing.length === 0) return out;

    try {
      const inventory = await this.listOnce(ttl);
      const online = new Map(inventory.devices.map((d) => [d.vendorDeviceId, d.online]));
      const at = inventory.fetchedAt.toISOString();
      const fresh = new Map<string, DisplayStatus>();
      const notListed: { id: bigint }[] = [];
      for (const device of devices) {
        if (!online.has(device.vendorDeviceId) && !inventory.complete) {
          // a paged list says nothing about cameras on later pages
          notListed.push(device);
          continue;
        }
        const value = online.get(device.vendorDeviceId);
        const state: DisplayState = value === true ? 'online' : value === false ? 'offline' : 'unknown';
        fresh.set(String(device.id), { platformState: state, platformStatusFetchedAt: at });
      }
      const fallback = notListed.length ? await this.fromDeviceState(notListed) : new Map<string, DisplayStatus>();
      for (const device of missing) {
        const id = String(device.id);
        out.set(id, fresh.get(id) ?? fallback.get(id)!);
      }
      if (ttl > 0) await this.writeCache(fresh, ttl);
    } catch (error) {
      if (!(error instanceof DssRecentlyFailed)) {
        this.logger.warn(
          `Could not get camera status from DSS, using the latest status in the system instead: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      for (const [id, status] of await this.fromDeviceState(missing)) out.set(id, status);
    }
    return out;
  }

  private listOnce(ttlSeconds: number): Promise<VendorInventory> {
    if (Date.now() < this.failedUntil) return Promise.reject(new DssRecentlyFailed('DSS failed recently'));
    if (!this.inflight) {
      this.inflight = this.dss
        .listDevices()
        .catch((error: unknown) => {
          if (ttlSeconds > 0) this.failedUntil = Date.now() + ttlSeconds * 1000;
          throw error;
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.inflight;
  }

  private async readCache(devices: readonly { id: bigint }[]): Promise<Map<string, DisplayStatus>> {
    const out = new Map<string, DisplayStatus>();
    if (!this.redis?.isReady) return out;
    try {
      const values = await this.redis.mGet(devices.map((d) => deviceStatusCacheKey(d.id)));
      values.forEach((raw, i) => {
        if (!raw) return;
        const value = JSON.parse(raw) as CachedValue;
        out.set(String(devices[i].id), { platformState: value.s, platformStatusFetchedAt: value.at });
      });
    } catch (error) {
      this.logger.warn(`Could not read the camera status cache, asking DSS directly: ${error instanceof Error ? error.message : String(error)}`);
      out.clear();
    }
    return out;
  }

  private async writeCache(statuses: Map<string, DisplayStatus>, ttl: number): Promise<void> {
    if (!this.redis?.isReady) return;
    try {
      await Promise.all(
        [...statuses].map(([id, status]) =>
          this.redis!.set(
            deviceStatusCacheKey(id),
            JSON.stringify({ s: status.platformState, at: status.platformStatusFetchedAt } satisfies CachedValue),
            { EX: ttl },
          ),
        ),
      );
    } catch (error) {
      this.logger.warn(`Could not write the camera status cache: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async fromDeviceState(devices: readonly { id: bigint }[]): Promise<Map<string, DisplayStatus>> {
    const unknownAfter = await this.settings.getInt('status.unknown-after-seconds');
    const rows = await this.db
      .select({ id: DeviceState.DeviceId, platformState: DeviceState.PlatformState, lastObservedAt: DeviceState.LastObservedAt })
      .from(DeviceState)
      .where(
        inArray(
          DeviceState.DeviceId,
          devices.map((d) => d.id),
        ),
      );
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    const now = new Date();
    const out = new Map<string, DisplayStatus>();
    for (const device of devices) {
      const row = byId.get(String(device.id));
      out.set(String(device.id), {
        platformState: row ? displayStateOf(row, now, unknownAfter) : 'unknown',
        platformStatusFetchedAt: null,
      });
    }
    return out;
  }
}

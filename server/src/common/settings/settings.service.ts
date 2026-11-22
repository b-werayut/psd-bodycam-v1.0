import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Settings } from '../../db/schema';
import { SETTING_DEFAULTS, type SettingKey } from './setting-spec';

const CACHE_TTL_MS = 30_000;

/**
 * Reads Settings rows with a 30 s per-process cache. A PATCH invalidates this process at once;
 * other processes (worker) pick the change up within 30 s.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, { value: string | null; at: number }>();

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async getInt(key: SettingKey): Promise<number> {
    const fallback = Number(SETTING_DEFAULTS[key]);
    const raw = await this.read(key);
    if (raw === null) return fallback;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
    this.logger.warn(`Settings '${key}' = '${raw}' แปลงเป็นจำนวนเต็มไม่ได้ ใช้ค่าเริ่มต้น ${fallback}`);
    return fallback;
  }

  async getBool(key: SettingKey): Promise<boolean> {
    const raw = await this.read(key);
    return raw === null ? Boolean(SETTING_DEFAULTS[key]) : raw === 'true';
  }

  async getString(key: SettingKey): Promise<string> {
    return (await this.read(key)) ?? String(SETTING_DEFAULTS[key]);
  }

  invalidate(key?: string): void {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }

  private async read(key: string): Promise<string | null> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    try {
      const [row] = await this.db
        .select({ value: Settings.SettingValue })
        .from(Settings)
        .where(eq(Settings.SettingKey, key))
        .limit(1);
      const value = row?.value ?? null;
      this.cache.set(key, { value, at: Date.now() });
      return value;
    } catch (error) {
      this.logger.warn(`อ่าน Settings '${key}' ไม่ได้ ใช้ค่าเริ่มต้น: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { getUserId } from '../../common/context/request-context';
import { AppException } from '../../common/errors/app-exception';
import { checkSettingValue, settingBound } from '../../common/settings/setting-spec';
import { SettingsService } from '../../common/settings/settings.service';
import { DRIZZLE } from '../../db/db.constants';
import type { DrizzleDB } from '../../db/db.types';
import { Settings } from '../../db/schema';

/** Shape of client `SettingItem` (client/src/features/settings/settings.api.ts). */
export type SettingItemView = {
  key: string;
  value: string;
  valueType: number;
  description: string;
  min: number | null;
  max: number | null;
};

type SettingRow = typeof Settings.$inferSelect;

@Injectable()
export class SettingsAdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly settings: SettingsService,
  ) {}

  async findAll(): Promise<{ groups: { category: string; items: SettingItemView[] }[]; total: number }> {
    const rows = await this.db.select().from(Settings).orderBy(asc(Settings.Category), asc(Settings.SettingKey));
    const groups = new Map<string, SettingItemView[]>();
    for (const row of rows) {
      const category = row.Category ?? 'other';
      groups.set(category, [...(groups.get(category) ?? []), toView(row)]);
    }
    return { groups: [...groups].map(([category, items]) => ({ category, items })), total: rows.length };
  }

  async update(key: string, raw: string): Promise<SettingItemView> {
    const [row] = await this.db.select().from(Settings).where(eq(Settings.SettingKey, key)).limit(1);
    if (!row) throw new AppException(404, 'NOT_FOUND', `ไม่พบค่าตั้งค่า '${key}'`);

    const checked = checkSettingValue(key, row.ValueType, raw);
    if (!checked.ok) throw new AppException(400, 'SETTING_OUT_OF_RANGE', checked.message);

    const [updated] = await this.db
      .update(Settings)
      .set({ SettingValue: checked.normalized, UpdatedAt: new Date(), UpdatedBy: getUserId() ?? null })
      .where(eq(Settings.SettingKey, key))
      .returning();
    this.settings.invalidate(key);
    return toView(updated);
  }
}

function toView(row: SettingRow): SettingItemView {
  const bound = settingBound(row.SettingKey);
  return {
    key: row.SettingKey,
    value: row.SettingValue ?? '',
    valueType: row.ValueType,
    description: row.Description ?? '',
    min: bound?.min ?? null,
    max: bound?.max ?? null,
  };
}

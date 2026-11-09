import { api } from '@/lib/apiClient';

export const VALUE_TYPE = { STRING: 1, INT: 2, BOOL: 3 } as const;

export type SettingItem = {
  key: string;
  value: string;
  valueType: number;
  description: string;
  min?: number | null;
  max?: number | null;
};

export type SettingGroup = { category: string; items: SettingItem[] };

export type SettingsResponse = { groups: SettingGroup[]; total: number };

export const SETTINGS_KEY = ['settings'] as const;

export const settingsApi = {
  list: () => api.get<SettingsResponse>('/settings').then((r) => r.data),
  update: (key: string, value: string) =>
    api.patch<SettingItem>(`/settings/${encodeURIComponent(key)}`, { value }).then((r) => r.data),
};

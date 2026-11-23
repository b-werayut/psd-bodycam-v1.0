import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/apiClient';
import { historyApi } from './history.api';

vi.mock('@/lib/apiClient', () => ({ api: { get: vi.fn() } }));

const page = (from: number, count: number, total: number) => ({
  data: {
    data: Array.from({ length: count }, (_, i) => ({ id: String(from + i), deviceCode: `C-${from + i}`, name: null })),
    page: 1,
    pageSize: 100,
    total,
  },
});

describe('historyApi.devices (review #8)', () => {
  beforeEach(() => vi.mocked(api.get).mockReset());

  it('loads every page of cameras, not only the first 100', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce(page(1, 100, 230))
      .mockResolvedValueOnce(page(101, 100, 230))
      .mockResolvedValueOnce(page(201, 30, 230));
    const devices = await historyApi.devices();
    expect(devices).toHaveLength(230);
    expect(devices[229]).toEqual({ id: '230', deviceCode: 'C-230', name: null });
    expect(vi.mocked(api.get).mock.calls.map((c) => (c[1] as { params: { page: number } }).params.page)).toEqual([1, 2, 3]);
  });

  it('stops on an empty page even if total says more', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(page(1, 100, 500)).mockResolvedValueOnce(page(101, 0, 500));
    expect(await historyApi.devices()).toHaveLength(100);
  });
});

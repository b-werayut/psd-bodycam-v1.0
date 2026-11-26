import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/apiClient';

import { streamingApi } from './streaming.api';

vi.mock('@/lib/apiClient', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

describe('streamingApi.recordings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends deviceId / from / to as query params and returns the body', async () => {
    const body = { data: [], from: 'a', to: 'b' };
    vi.mocked(api.get).mockResolvedValue({ data: body });
    const query = { deviceId: '7', from: '2026-11-25T17:00:00.000Z', to: '2026-11-26T08:00:00.000Z' };
    await expect(streamingApi.recordings(query)).resolves.toEqual(body);
    expect(api.get).toHaveBeenCalledWith('/streams/recordings', { params: query });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import {
  TALK_CLOSE_CODE,
  TALK_START_TIMEOUT_MS,
  talkApi,
  talkWsUrlFor,
  type TalkStartResponse,
} from './talk.api';

const START: TalkStartResponse = {
  talkSessionId: '77',
  wsUrl: '/api/talk/ws?ticket=abc',
  uplinkSampleRate: 8000,
  downlinkSampleRate: 8000,
  frameMs: 40,
  maxSeconds: 600,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ accessToken: null, user: null });
});

describe('talkApi', () => {
  it('start: POST /talk/sessions ด้วย sessionToken ของภาพสด และรอได้ 35 วินาที (มากกว่า start timeout 30 วินาทีของ server)', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: START } as never);

    await expect(talkApi.start('live-1')).resolves.toEqual(START);
    expect(post).toHaveBeenCalledWith(
      '/talk/sessions',
      { streamSessionToken: 'live-1' },
      { timeout: 35_000 },
    );
    expect(TALK_START_TIMEOUT_MS).toBe(35_000);
    expect(TALK_START_TIMEOUT_MS).toBeGreaterThan(30_000);
  });

  it('stop: POST /talk/sessions/:id/stop', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({
        data: { talkSessionId: '77', status: 3, endReason: 1, durationSeconds: 12 },
      } as never);

    await talkApi.stop('77');

    expect(post).toHaveBeenCalledWith('/talk/sessions/77/stop');
  });

  it('**stopOnUnload ใช้ fetch แบบ keepalive พร้อม Bearer token** (axios ถูกยกเลิกเมื่อปิดหน้า)', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ accessToken: 'jwt-1' });

    talkApi.stopOnUnload('77');

    expect(fetchMock).toHaveBeenCalledWith(`${api.defaults.baseURL}/talk/sessions/77/stop`, {
      method: 'POST',
      keepalive: true,
      headers: { Authorization: 'Bearer jwt-1' },
    });
  });

  it('stopOnUnload ล้มเงียบ ๆ — ทำให้ดีที่สุดเท่านั้น', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    expect(() => talkApi.stopOnUnload('77')).not.toThrow();
    await Promise.resolve();
  });
});

describe('talkWsUrlFor', () => {
  it('same-origin บน https -> wss ของ host หน้าเว็บ', () => {
    expect(
      talkWsUrlFor('/api/talk/ws?ticket=abc', '/api', {
        protocol: 'https:',
        host: 'bodycam.example.com',
      }),
    ).toBe('wss://bodycam.example.com/api/talk/ws?ticket=abc');
  });

  it('dev (http + vite proxy) -> ws ของ host:port เดิม', () => {
    expect(
      talkWsUrlFor('/api/talk/ws?ticket=abc', undefined, {
        protocol: 'http:',
        host: 'localhost:5173',
      }),
    ).toBe('ws://localhost:5173/api/talk/ws?ticket=abc');
  });

  it('API คนละโดเมน -> origin ของ API (ตรงกับ realtimeTarget ของ Socket.IO)', () => {
    expect(
      talkWsUrlFor('/api/talk/ws?ticket=abc', 'https://api.example.com/api', {
        protocol: 'https:',
        host: 'web.example.com',
      }),
    ).toBe('wss://api.example.com/api/talk/ws?ticket=abc');
  });

  it('VITE_API_BASE แกะไม่ออก -> ถอยไปใช้ host ของหน้าเว็บ', () => {
    expect(
      talkWsUrlFor('/api/talk/ws?ticket=abc', 'ไม่ใช่ url', {
        protocol: 'http:',
        host: 'localhost:5173',
      }),
    ).toBe('ws://localhost:5173/api/talk/ws?ticket=abc');
  });
});

describe('TALK_CLOSE_CODE', () => {
  it('ตรงกับตาราง close code ใน spec (ชุดเดียวกันทั้งสองทอด)', () => {
    expect(TALK_CLOSE_CODE).toEqual({
      NORMAL: 1000,
      NETWORK: 1006,
      FRAME: 1008,
      MAX_DURATION: 4001,
      IDLE: 4002,
      VENDOR_ENDED: 4003,
      STOPPED: 4004,
      VENDOR_ERROR: 4005,
      POLICY: 4006,
      TICKET: 4401,
    });
  });
});

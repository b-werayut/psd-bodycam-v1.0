import { describe, expect, it } from 'vitest';
import type { RedisClientType } from 'redis';

import { closeRedis, connectWithDeadline, redisConnectTimeoutMs } from './redis-connect';

type FakeClient = {
  isOpen: boolean;
  isReady: boolean;
  connect: () => Promise<unknown>;
  quit: () => Promise<unknown>;
  disconnect: () => Promise<unknown>;
  destroy?: () => void;
  calls: string[];
};

function fakeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  const calls: string[] = [];
  const client: FakeClient = {
    isOpen: true,
    isReady: true,
    calls,
    connect: () => {
      calls.push('connect');
      return Promise.resolve();
    },
    quit: () => {
      calls.push('quit');
      client.isOpen = false;
      client.isReady = false;
      return Promise.resolve();
    },
    disconnect: () => {
      calls.push('disconnect');
      client.isOpen = false;
      return Promise.resolve();
    },
    destroy: () => {
      calls.push('destroy');
      client.isOpen = false;
    },
    ...overrides,
  };
  return client;
}

const asClient = (c: FakeClient) => c as unknown as RedisClientType;

describe('redisConnectTimeoutMs', () => {
  it('ไม่ตั้ง env -> 5000 ms', () => {
    expect(redisConnectTimeoutMs({})).toBe(5_000);
  });

  it('ตั้งได้ในช่วง 500–60000 ms', () => {
    expect(redisConnectTimeoutMs({ REDIS_CONNECT_TIMEOUT_MS: '1500' })).toBe(1_500);
  });

  it('ค่านอกช่วง/อ่านไม่ได้ -> กลับไปใช้ default (ห้ามได้ 0 = ตัดทันทีทุกครั้ง)', () => {
    for (const bad of ['0', '-1', '100', '999999', 'abc', '', '  ']) {
      expect(redisConnectTimeoutMs({ REDIS_CONNECT_TIMEOUT_MS: bad })).toBe(5_000);
    }
  });
});

describe('connectWithDeadline', () => {
  it('ต่อติด -> true', async () => {
    await expect(connectWithDeadline(asClient(fakeClient()), 500)).resolves.toBe(true);
  });

  it('**connect ไม่คืนค่าเลย (Redis ยังไม่ขึ้น) -> false ตามเพดานเวลา ไม่ค้าง**', async () => {
    const client = fakeClient({ connect: () => new Promise(() => undefined) });
    const startedAt = Date.now();

    await expect(connectWithDeadline(asClient(client), 200)).resolves.toBe(false);

    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it('connect reject -> false และไม่เกิด unhandled rejection', async () => {
    const client = fakeClient({ connect: () => Promise.reject(new Error('ECONNREFUSED')) });
    await expect(connectWithDeadline(asClient(client), 500)).resolves.toBe(false);
  });
});

describe('closeRedis', () => {
  it('client พร้อมใช้ -> ปิดสุภาพด้วย quit', async () => {
    const client = fakeClient();
    await closeRedis(asClient(client));
    expect(client.calls).toEqual(['quit']);
  });

  it('**กำลังวน reconnect (isOpen แต่ยังไม่ isReady) -> ไม่เรียก quit** (quit จะค้าง)', async () => {
    const client = fakeClient({ isReady: false });
    await closeRedis(asClient(client));
    expect(client.calls).toEqual(['destroy']);
  });

  it('quit ค้าง -> ตัดการเชื่อมต่อทิ้งตามเพดานเวลา ไม่ค้างตลอดไป', async () => {
    const client = fakeClient({ quit: () => new Promise(() => undefined) });
    const startedAt = Date.now();

    await closeRedis(asClient(client));

    expect(client.calls).toContain('destroy');
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it('ไม่มี destroy (redis รุ่นเก่า) -> ใช้ disconnect เป็นทางสำรอง', async () => {
    const client = fakeClient({ isReady: false, destroy: undefined });
    await closeRedis(asClient(client));
    expect(client.calls).toEqual(['disconnect']);
  });

  it('ปิดอยู่แล้ว -> ไม่ทำอะไร', async () => {
    const client = fakeClient({ isOpen: false, isReady: false });
    await closeRedis(asClient(client));
    expect(client.calls).toEqual([]);
  });
});

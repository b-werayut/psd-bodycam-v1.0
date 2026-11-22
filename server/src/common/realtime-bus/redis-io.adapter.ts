import { Logger, type INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, type RedisClientType } from 'redis';
import type { ServerOptions } from 'socket.io';
import { closeRedis, connectWithDeadline, redisUrl } from '../redis/redis-connect';
import { REALTIME_REDIS_KEY } from './realtime-bus.types';

/**
 * Socket.IO adapter of the api: with Redis, events emitted by worker processes (Redis emitter) and by
 * other api pods reach every socket. Without Redis it falls back to the in-memory adapter (one api only).
 */
export class RedisIoAdapter extends IoAdapter {
  private static readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private clients: RedisClientType[] = [];

  constructor(app: INestApplication) {
    super(app);
  }

  async connect(): Promise<boolean> {
    const url = redisUrl();
    if (!url) {
      RedisIoAdapter.logger.warn('ไม่ได้ตั้ง REDIS_URL — Socket.IO ใช้ adapter ในหน่วยความจำ (event จาก worker จะไม่ถึงผู้ใช้)');
      return false;
    }

    const pubClient = createClient({ url }) as RedisClientType;
    const subClient = pubClient.duplicate() as RedisClientType;
    const warned = new Set<RedisClientType>();
    for (const client of [pubClient, subClient]) {
      client.on('error', (error: Error) => {
        if (warned.has(client)) return;
        warned.add(client);
        RedisIoAdapter.logger.warn(`การเชื่อมต่อ Redis (Socket.IO) มีปัญหา: ${error.message}`);
      });
    }
    this.clients = [pubClient, subClient];

    const connected = await Promise.all([connectWithDeadline(pubClient), connectWithDeadline(subClient)]);
    if (connected.every(Boolean)) {
      this.adapterConstructor = createAdapter(pubClient, subClient, { key: REALTIME_REDIS_KEY });
      RedisIoAdapter.logger.log('Socket.IO ใช้ Redis adapter (รับ event จาก worker + scale-out)');
      return true;
    }

    RedisIoAdapter.logger.warn(
      `ต่อ Redis ไม่ได้ (${url}) — Socket.IO ใช้ adapter ในหน่วยความจำ · event จาก worker จะไม่ถึงผู้ใช้ ` +
        'จนกว่า Redis ขึ้นแล้ว restart โปรเซส api',
    );
    await Promise.all(this.clients.map((client) => closeRedis(client)));
    this.clients = [];
    return false;
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as {
      adapter: (factory: ReturnType<typeof createAdapter>) => void;
    };
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }

  async close(server: unknown): Promise<void> {
    await super.close(server as Parameters<IoAdapter['close']>[0]);
    await Promise.all(this.clients.map((client) => closeRedis(client)));
    this.clients = [];
  }
}

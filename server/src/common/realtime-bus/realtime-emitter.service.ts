import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import { createClient, type RedisClientType } from 'redis';
import { closeRedis, connectWithDeadline, redisUrl } from '../redis/redis-connect';
import { REALTIME_NAMESPACE, REALTIME_REDIS_KEY, type BroadcastBus } from './realtime-bus.types';

/**
 * Lets a process without a Socket.IO server (the worker) push events to sockets held by the api,
 * through Redis. `bus` is null until Redis answers; data is in the DB either way.
 */
@Injectable()
export class RealtimeEmitterService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeEmitterService.name);
  private client: RedisClientType | null = null;
  private emitter: BroadcastBus | null = null;

  get bus(): BroadcastBus | null {
    return this.emitter;
  }

  async onModuleInit(): Promise<void> {
    const url = redisUrl();
    if (!url) {
      this.logger.log('ไม่ได้ตั้ง REDIS_URL — โปรเซสนี้ push realtime ไม่ได้');
      return;
    }

    const client = createClient({ url }) as RedisClientType;
    let warned = false;
    client.on('error', (error: Error) => {
      if (warned) return;
      warned = true;
      this.logger.warn(`การเชื่อมต่อ Redis (realtime emitter) มีปัญหา: ${error.message}`);
    });
    this.client = client;

    if (await connectWithDeadline(client)) {
      this.use(client);
      return;
    }
    this.logger.error(`ยังต่อ Redis ไม่ได้ (${url}) — ยัง push realtime ไม่ได้จนกว่าจะต่อติด (ข้อมูลยังลง DB ครบ)`);
    client.once('ready', () => {
      warned = false;
      this.use(client);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.client) return;
    await closeRedis(this.client);
    this.client = null;
    this.emitter = null;
  }

  private use(client: RedisClientType): void {
    this.emitter = new Emitter(client, { key: REALTIME_REDIS_KEY }).of(REALTIME_NAMESPACE) as unknown as BroadcastBus;
    this.logger.log(`push realtime ผ่าน Redis ได้แล้ว (namespace ${REALTIME_NAMESPACE})`);
  }
}

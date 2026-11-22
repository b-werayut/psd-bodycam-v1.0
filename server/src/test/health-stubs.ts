import type { Provider } from '@nestjs/common';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { DRIZZLE } from '../db/db.constants';

/** Lets unit tests mount AppController (health endpoints) without a real DB or Redis. */
export const HEALTH_STUB_PROVIDERS: Provider[] = [
  { provide: DRIZZLE, useValue: { execute: () => Promise.resolve([]) } },
  { provide: REDIS_CLIENT, useValue: null },
];

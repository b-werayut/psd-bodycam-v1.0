import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './schema';

export type DrizzleDB = PostgresJsDatabase<typeof schema>;

export type DrizzleTx = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];

export type DrizzleExecutor = DrizzleDB | DrizzleTx;

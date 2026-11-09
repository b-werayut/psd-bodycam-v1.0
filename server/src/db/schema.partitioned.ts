import { sql } from 'drizzle-orm';
import { bigint, jsonb, pgTable, smallint, varchar } from 'drizzle-orm/pg-core';
import { tstz } from './columns';

// AuditLogs is partitioned by month on "OccurredAt". This file is deliberately NOT in
// drizzle.config.ts `schema`, so drizzle-kit never generates DDL for it; the real DDL is
// custom SQL in drizzle/0001_extensions_partitions.sql. It exists only for typed queries.
// No FK to Users: audit rows must outlive (and not block) user changes.
export const AuditLogs = pgTable('AuditLogs', {
  Id: bigint('Id', { mode: 'bigint' })
    .notNull()
    .default(sql`nextval('"AuditLogs_Id_seq"')`),
  UserId: bigint('UserId', { mode: 'bigint' }),
  ActorUsername: varchar('ActorUsername', { length: 50 }),
  ActorRole: varchar('ActorRole', { length: 30 }),
  Action: varchar('Action', { length: 50 }).notNull(),
  ResourceType: varchar('ResourceType', { length: 50 }),
  ResourceId: bigint('ResourceId', { mode: 'bigint' }),
  Changes: jsonb('Changes'),
  HttpMethod: varchar('HttpMethod', { length: 10 }),
  RequestPath: varchar('RequestPath', { length: 300 }),
  Result: smallint('Result').notNull().default(1),
  Ip: varchar('Ip', { length: 45 }),
  UserAgent: varchar('UserAgent', { length: 300 }),
  CorrelationId: varchar('CorrelationId', { length: 64 }),
  OccurredAt: tstz('OccurredAt').notNull().defaultNow(),
});

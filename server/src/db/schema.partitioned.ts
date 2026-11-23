import { sql } from 'drizzle-orm';
import { bigint, boolean, doublePrecision, jsonb, pgTable, real, smallint, varchar } from 'drizzle-orm/pg-core';
import { tstz } from './columns';

// AuditLogs (by "OccurredAt") and GpsLocations (by "RecordedAt") are partitioned by month. This file is
// deliberately NOT in drizzle.config.ts `schema`, so drizzle-kit never generates DDL for it; the real DDL
// is custom SQL in drizzle/0001_extensions_partitions.sql and 0006_p1_tracking_custom.sql. It exists only
// for typed queries. Next months' partitions come from the worker job PartitionMaintenance.
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

// No FK and no surrogate Id (volume). PK ("DeviceId", "RecordedAt") includes the partition key, so a
// repeated point is a no-op with ON CONFLICT DO NOTHING. Drift filter > 200 km/h => IsValidFix = false (kept).
export const GpsLocations = pgTable('GpsLocations', {
  DeviceId: bigint('DeviceId', { mode: 'bigint' }).notNull(),
  RecordedAt: tstz('RecordedAt').notNull(),
  ReceivedAt: tstz('ReceivedAt').notNull().defaultNow(),
  Lat: doublePrecision('Lat').notNull(),
  Lng: doublePrecision('Lng').notNull(),
  SpeedKph: real('SpeedKph'),
  Heading: smallint('Heading'),
  AltitudeM: real('AltitudeM'),
  SatelliteCount: smallint('SatelliteCount'),
  IsValidFix: boolean('IsValidFix').notNull().default(true),
  BatteryPercent: smallint('BatteryPercent'),
});

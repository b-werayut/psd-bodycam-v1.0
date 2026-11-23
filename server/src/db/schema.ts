import {
  type AnyPgColumn,
  boolean,
  char,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  auditActor,
  bindUsersIdColumn,
  createdAt,
  fk,
  notDeleted,
  pkId,
  ref,
  softDelete,
  tstz,
  updatedAt,
  userRef,
} from './columns';

// Canonical names: docs/blueprint/04-database-design.md section 4.4.
// AuditLogs and GpsLocations are partitioned and live in schema.partitioned.ts (outside drizzle-kit's
// schema path). Exclusion constraints (EX_*) need btree_gist and are custom SQL in drizzle/0006.

export const Roles = pgTable('Roles', {
  Id: pkId(),
  Code: varchar('Code', { length: 30 }).notNull().unique('UQ_Roles_Code'),
  Name: varchar('Name', { length: 100 }).notNull(),
  Description: varchar('Description', { length: 300 }),
  IsSystem: boolean('IsSystem').notNull().default(true),
  CreatedAt: createdAt(),
  UpdatedAt: updatedAt(),
});

export const Users = pgTable(
  'Users',
  {
    Id: pkId(),
    // Stored lowercase by the application; uniqueness is case-insensitive on live rows.
    Username: varchar('Username', { length: 50 }).notNull(),
    // null = SSO-only account (argon2 hash otherwise)
    PasswordHash: varchar('PasswordHash', { length: 255 }),
    Email: varchar('Email', { length: 200 }),
    FullName: varchar('FullName', { length: 200 }).notNull(),
    // null = never linked (not "denied")
    AzureObjectId: varchar('AzureObjectId', { length: 64 }),
    RoleId: ref('RoleId', () => Roles.Id).notNull(),
    Status: smallint('Status').notNull().default(1),
    FailedLoginCount: smallint('FailedLoginCount').notNull().default(0),
    LockedUntil: tstz('LockedUntil'),
    LastLoginAt: tstz('LastLoginAt'),
    CreatedAt: createdAt(),
    UpdatedAt: updatedAt(),
    ...auditActor(),
    ...softDelete(),
  },
  (t) => [
    index('IX_Users_Role').on(t.RoleId),
    uniqueIndex('UQ_Users_Username').on(sql`lower(${t.Username})`).where(notDeleted(t)),
    uniqueIndex('UQ_Users_Email').on(sql`lower(${t.Email})`).where(notDeleted(t)),
    uniqueIndex('UQ_Users_AzureObjectId').on(t.AzureObjectId).where(notDeleted(t)),
  ],
);

bindUsersIdColumn(() => Users.Id);

export const Employees = pgTable(
  'Employees',
  {
    Id: pkId(),
    EmployeeCode: varchar('EmployeeCode', { length: 30 }).notNull(),
    FirstName: varchar('FirstName', { length: 100 }).notNull(),
    LastName: varchar('LastName', { length: 100 }).notNull(),
    Phone: varchar('Phone', { length: 30 }),
    UserId: ref('UserId', () => Users.Id),
    // [Assumption] Booking has an employee id
    BookingEmployeeRef: varchar('BookingEmployeeRef', { length: 64 }),
    Status: smallint('Status').notNull().default(1),
    CreatedAt: createdAt(),
    UpdatedAt: updatedAt(),
    ...auditActor(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex('UQ_Employees_Code').on(t.EmployeeCode).where(notDeleted(t)),
    uniqueIndex('UQ_Employees_User')
      .on(t.UserId)
      .where(sql`${t.UserId} is not null and ${t.IsDeleted} = false`),
    uniqueIndex('UQ_Employees_BookingRef')
      .on(t.BookingEmployeeRef)
      .where(sql`${t.BookingEmployeeRef} is not null and ${t.IsDeleted} = false`),
  ],
);

export const Permissions = pgTable(
  'Permissions',
  {
    Id: pkId(),
    // format `resource:action`
    Code: varchar('Code', { length: 100 }).notNull().unique('UQ_Permissions_Code'),
    Resource: varchar('Resource', { length: 50 }).notNull(),
    Action: varchar('Action', { length: 30 }).notNull(),
    Description: varchar('Description', { length: 300 }),
    CreatedAt: createdAt(),
  },
  (t) => [index('IX_Permissions_Resource').on(t.Resource)],
);

export const RolePermissions = pgTable(
  'RolePermissions',
  {
    RoleId: ref('RoleId', () => Roles.Id).notNull(),
    PermissionId: ref('PermissionId', () => Permissions.Id).notNull(),
    CreatedAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'PK_RolePermissions', columns: [t.RoleId, t.PermissionId] }),
    index('IX_RolePermissions_Permission').on(t.PermissionId),
  ],
);

// Mobile device registry. No PIN / biometric. `InstallationId` is the app-generated id
// (the reference called it `DeviceId`, which collides with the camera `Devices` table).
export const UserDevices = pgTable(
  'UserDevices',
  {
    Id: pkId(),
    UserId: ref('UserId', () => Users.Id).notNull(),
    InstallationId: varchar('InstallationId', { length: 100 }).notNull(),
    // 1 Android, 2 iOS, 3 Web
    Platform: smallint('Platform').notNull(),
    DeviceName: varchar('DeviceName', { length: 100 }),
    PushEnabled: boolean('PushEnabled').notNull().default(true),
    IsRevoked: boolean('IsRevoked').notNull().default(false),
    LastSeenAt: tstz('LastSeenAt'),
    CreatedAt: createdAt(),
  },
  (t) => [
    uniqueIndex('UQ_UserDevices_User_Installation').on(t.UserId, t.InstallationId),
    index('IX_UserDevices_User').on(t.UserId, t.IsRevoked),
  ],
);

export const RefreshTokens = pgTable(
  'RefreshTokens',
  {
    Id: pkId(),
    UserId: ref('UserId', () => Users.Id).notNull(),
    TokenHash: char('TokenHash', { length: 64 }).notNull().unique('UQ_RefreshTokens_TokenHash'),
    ExpiresAt: tstz('ExpiresAt').notNull(),
    RevokedAt: tstz('RevokedAt'),
    ReplacedByTokenId: ref('ReplacedByTokenId', (): AnyPgColumn => RefreshTokens.Id),
    // when this token was rotated; a replaced token seen again within the grace window = race, not reuse
    ReplacedAt: tstz('ReplacedAt'),
    UserDeviceId: ref('UserDeviceId', () => UserDevices.Id),
    CreatedAt: createdAt(),
  },
  (t) => [
    index('IX_RefreshTokens_User').on(t.UserId, t.ExpiresAt),
    index('IX_RefreshTokens_UserDevice').on(t.UserDeviceId),
  ],
);

export const PushTokens = pgTable(
  'PushTokens',
  {
    Id: pkId(),
    UserId: ref('UserId', () => Users.Id).notNull(),
    UserDeviceId: ref('UserDeviceId', () => UserDevices.Id),
    // global unique: a new login on the same handset transfers ownership
    Token: varchar('Token', { length: 512 }).notNull().unique('UQ_PushTokens_Token'),
    Platform: smallint('Platform'),
    IsRevoked: boolean('IsRevoked').notNull().default(false),
    FailureCount: smallint('FailureCount').notNull().default(0),
    LastUsedAt: tstz('LastUsedAt'),
    CreatedAt: createdAt(),
  },
  (t) => [
    index('IX_PushTokens_User').on(t.UserId, t.IsRevoked),
    index('IX_PushTokens_UserDevice').on(t.UserDeviceId),
  ],
);

// Bounds live in code (setting-spec.ts); defaults ship via data migration.
export const Settings = pgTable('Settings', {
  Id: pkId(),
  SettingKey: varchar('SettingKey', { length: 100 }).notNull().unique('UQ_Settings_Key'),
  SettingValue: text('SettingValue'),
  ValueType: smallint('ValueType').notNull(),
  Category: varchar('Category', { length: 50 }),
  Description: varchar('Description', { length: 500 }),
  IsSystem: boolean('IsSystem').notNull().default(false),
  UpdatedAt: updatedAt(),
  UpdatedBy: userRef('UpdatedBy'),
});

// ---- P1: Teams (Part 4 §4.4 B). Created from Booking data only (DL53), no team screen.

export const Teams = pgTable(
  'Teams',
  {
    Id: pkId(),
    Code: varchar('Code', { length: 30 }).notNull(),
    Name: varchar('Name', { length: 200 }).notNull(),
    // [Assumption] team / vehicle / shift ref in Booking
    BookingTeamRef: varchar('BookingTeamRef', { length: 64 }),
    IsActive: boolean('IsActive').notNull().default(true),
    CreatedAt: createdAt(),
    UpdatedAt: updatedAt(),
    ...auditActor(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex('UQ_Teams_Code').on(t.Code).where(notDeleted(t)),
    uniqueIndex('UQ_Teams_BookingRef')
      .on(t.BookingTeamRef)
      .where(sql`${t.BookingTeamRef} is not null and ${t.IsDeleted} = false`),
  ],
);

/** History, never deleted: a row is closed with ValidTo. Role 1 Leader · 2 Member. */
export const TeamMembers = pgTable(
  'TeamMembers',
  {
    Id: pkId(),
    TeamId: ref('TeamId', () => Teams.Id).notNull(),
    EmployeeId: ref('EmployeeId', () => Employees.Id).notNull(),
    Role: smallint('Role').notNull(),
    ValidFrom: tstz('ValidFrom').notNull(),
    ValidTo: tstz('ValidTo'),
    // null = system (inbox processor)
    AssignedBy: userRef('AssignedBy'),
    Note: varchar('Note', { length: 500 }),
    CreatedAt: createdAt(),
  },
  (t) => [
    check('CK_TeamMembers_Window', sql`${t.ValidTo} is null or ${t.ValidTo} > ${t.ValidFrom}`),
    uniqueIndex('UQ_TeamMembers_ActiveLeader').on(t.TeamId).where(sql`${t.Role} = 1 and ${t.ValidTo} is null`),
    uniqueIndex('UQ_TeamMembers_ActiveEmployee').on(t.EmployeeId).where(sql`${t.ValidTo} is null`),
    index('IX_TeamMembers_Team').on(t.TeamId, t.ValidFrom.desc()),
  ],
);

// ---- P1: Devices (Part 4 §4.4 C). Written only by the worker job DeviceSync (DL53).

/** Kind 1 Primary · 2 Spare. Status 1 Active · 2 Inactive · 3 Maintenance · 4 Retired. */
export const Devices = pgTable(
  'Devices',
  {
    Id: pkId(),
    DeviceCode: varchar('DeviceCode', { length: 30 }).notNull(),
    // = DSS deviceCode; unique forever (soft-deleted rows included)
    VendorDeviceId: varchar('VendorDeviceId', { length: 64 }).notNull(),
    Name: varchar('Name', { length: 200 }),
    Model: varchar('Model', { length: 100 }),
    SerialNo: varchar('SerialNo', { length: 100 }),
    Firmware: varchar('Firmware', { length: 100 }),
    SimNumber: varchar('SimNumber', { length: 30 }),
    Kind: smallint('Kind').notNull(),
    Status: smallint('Status').notNull().default(1),
    StreamingEnabled: boolean('StreamingEnabled').notNull().default(true),
    VendorSeenAt: tstz('VendorSeenAt'),
    VendorMissingSince: tstz('VendorMissingSince'),
    CreatedAt: createdAt(),
    UpdatedAt: updatedAt(),
    ...auditActor(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex('UQ_Devices_Code').on(t.DeviceCode).where(notDeleted(t)),
    uniqueIndex('UQ_Devices_VendorId').on(t.VendorDeviceId),
    index('IX_Devices_Status').on(t.Status),
  ],
);

/**
 * Hot row, 1:1 with Devices: DeviceSync inserts it with the device, observations only UPDATE it.
 * PlatformState 1 Online · 2 Offline · null = never seen (UNKNOWN is computed, never stored).
 * Sources: 2 DssLocation · 5 Manual (1, 3, 4 reserved — never reuse).
 */
export const DeviceState = pgTable(
  'DeviceState',
  {
    DeviceId: ref('DeviceId', () => Devices.Id).primaryKey(),
    PlatformState: smallint('PlatformState'),
    StateSince: tstz('StateSince'),
    LastObservedAt: tstz('LastObservedAt'),
    LastOnlineObservedAt: tstz('LastOnlineObservedAt'),
    LastSource: smallint('LastSource'),
    StateSource: smallint('StateSource'),
    StateSourceObservedAt: tstz('StateSourceObservedAt'),
    LastFixAt: tstz('LastFixAt'),
    LastLat: doublePrecision('LastLat'),
    LastLng: doublePrecision('LastLng'),
    LastSpeedKph: real('LastSpeedKph'),
    LastHeading: smallint('LastHeading'),
    LastFixValid: boolean('LastFixValid'),
    LastBatteryPercent: smallint('LastBatteryPercent'),
    // null = no fix
    IsAtDepot: boolean('IsAtDepot'),
    UpdatedAt: updatedAt(),
  },
  (t) => [index('IX_DeviceState_PlatformState').on(t.PlatformState)],
);

/** Append-only, one row per state transition. */
export const DeviceStatusHistory = pgTable(
  'DeviceStatusHistory',
  {
    Id: pkId(),
    DeviceId: ref('DeviceId', () => Devices.Id).notNull(),
    FromState: smallint('FromState'),
    ToState: smallint('ToState').notNull(),
    ObservedAt: tstz('ObservedAt').notNull(),
    Source: smallint('Source').notNull(),
    CreatedAt: createdAt(),
  },
  (t) => [index('IX_DeviceStatusHistory_Device').on(t.DeviceId, t.ObservedAt.desc())],
);

/** Charging bases (Q15). No screen in the first phase (DL53): empty in production, dev seed has mocks. */
export const Depots = pgTable(
  'Depots',
  {
    Id: pkId(),
    Code: varchar('Code', { length: 30 }).notNull(),
    Name: varchar('Name', { length: 200 }).notNull(),
    Lat: doublePrecision('Lat').notNull(),
    Lng: doublePrecision('Lng').notNull(),
    RadiusM: integer('RadiusM').notNull().default(150),
    IsActive: boolean('IsActive').notNull().default(true),
    CreatedAt: createdAt(),
    UpdatedAt: updatedAt(),
    ...auditActor(),
    ...softDelete(),
  },
  (t) => [
    uniqueIndex('UQ_Depots_Code').on(t.Code).where(notDeleted(t)),
    check('CK_Depots_Radius', sql`${t.RadiusM} between 20 and 2000`),
  ],
);

// ---- P1: Alerts (Part 4 §4.4 H). Notifications come with the alert phase (P2).

/**
 * AlertType: Part 5 §5.6. Severity 1 Info · 2 Warning · 3 Critical. Status 1 New · 2 Acknowledged ·
 * 3 Resolved · 4 Dismissed. WorkOrderId / TrackingSessionId / BookingJobId get their FKs in the
 * phase that creates those tables.
 */
export const Alerts = pgTable(
  'Alerts',
  {
    Id: pkId(),
    AlertType: smallint('AlertType').notNull(),
    Severity: smallint('Severity').notNull(),
    Status: smallint('Status').notNull().default(1),
    DeviceId: ref('DeviceId', () => Devices.Id),
    TeamId: ref('TeamId', () => Teams.Id),
    WorkOrderId: fk('WorkOrderId'),
    TrackingSessionId: fk('TrackingSessionId'),
    BookingJobId: fk('BookingJobId'),
    Title: varchar('Title', { length: 200 }),
    Message: text('Message'),
    Data: jsonb('Data'),
    DedupeKey: varchar('DedupeKey', { length: 150 }),
    OccurredAt: tstz('OccurredAt').notNull().defaultNow(),
    AcknowledgedAt: tstz('AcknowledgedAt'),
    AcknowledgedBy: userRef('AcknowledgedBy'),
    ResolvedAt: tstz('ResolvedAt'),
    ResolvedBy: userRef('ResolvedBy'),
  },
  (t) => [
    uniqueIndex('UQ_Alerts_OpenDedupe').on(t.DedupeKey).where(sql`${t.Status} in (1, 2)`),
    index('IX_Alerts_Status').on(t.Status, t.Severity, t.OccurredAt.desc()),
  ],
);

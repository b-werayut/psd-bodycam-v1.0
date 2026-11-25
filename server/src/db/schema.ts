import {
  type AnyPgColumn,
  boolean,
  char,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  unique,
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
    Phone: varchar('Phone', { length: 30 }),
    // [Assumption] External leader reference provided by Booking.
    BookingEmployeeRef: varchar('BookingEmployeeRef', { length: 64 }),
    FirstName: varchar('FirstName', { length: 200 }).notNull(),
    LastName: varchar('LastName', { length: 200 }).notNull(),
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
    uniqueIndex('UQ_Users_BookingEmployeeRef').on(t.BookingEmployeeRef).where(notDeleted(t)),
  ],
);

bindUsersIdColumn(() => Users.Id);

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
    Code: varchar('Code', { length: 64 }).notNull(),
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
    UserId: ref('UserId', () => Users.Id).notNull(),
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
    uniqueIndex('UQ_TeamMembers_ActiveUser').on(t.UserId).where(sql`${t.ValidTo} is null`),
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
    WorkOrderId: ref('WorkOrderId', () => WorkOrders.Id),
    TrackingSessionId: fk('TrackingSessionId'),
    BookingJobId: ref('BookingJobId', () => BookingJobs.Id),
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

// ---- P3a: Booking inbound + work orders (Part 4 §4.4 E, F). Enums: Part 4 §4.3.

/** Status 1 Pending · 2 Processed · 3 Failed · 4 Ignored · 5 Dead. Channel 1 Push · 2 Reconcile · 3 CsvImport · 4 Refresh. */
export const IntegrationInbox = pgTable(
  'IntegrationInbox',
  {
    Id: pkId(),
    Source: varchar('Source', { length: 30 }).notNull(),
    ExternalEventId: varchar('ExternalEventId', { length: 200 }).notNull(),
    EventType: varchar('EventType', { length: 50 }),
    Channel: smallint('Channel').notNull().default(1),
    Payload: jsonb('Payload').notNull(),
    ReceivedAt: tstz('ReceivedAt').notNull().defaultNow(),
    Status: smallint('Status').notNull(),
    Attempts: smallint('Attempts').notNull().default(0),
    LastError: text('LastError'),
    ProcessedAt: tstz('ProcessedAt'),
  },
  (t) => [
    uniqueIndex('UQ_Inbox_Event').on(t.Source, t.ExternalEventId),
    index('IX_Inbox_Pending')
      .on(t.Status, t.ReceivedAt)
      .where(sql`${t.Status} in (1, 3)`),
  ],
);

export const IntegrationSyncState = pgTable(
  'IntegrationSyncState',
  {
    Source: varchar('Source', { length: 30 }).notNull(),
    Resource: varchar('Resource', { length: 50 }).notNull(),
    LastReceivedAt: tstz('LastReceivedAt'),
    LastAttemptAt: tstz('LastAttemptAt'),
    LastSuccessAt: tstz('LastSuccessAt'),
    LastFullSyncAt: tstz('LastFullSyncAt'),
    LastErrorAt: tstz('LastErrorAt'),
    LastError: text('LastError'),
    ConsecutiveFailures: integer('ConsecutiveFailures').notNull().default(0),
    BreakerOpenUntil: tstz('BreakerOpenUntil'),
  },
  (t) => [primaryKey({ name: 'PK_IntegrationSyncState', columns: [t.Source, t.Resource] })],
);

/** Direction 1 Outbound · 2 Inbound. Outcome 1 Success · 2 HttpError · 3 Timeout · 4 NetworkError · 5 CircuitOpen · 6 InvalidResponse. */
export const IntegrationCallLogs = pgTable(
  'IntegrationCallLogs',
  {
    Id: pkId(),
    Source: varchar('Source', { length: 30 }).notNull(),
    Direction: smallint('Direction').notNull(),
    Operation: varchar('Operation', { length: 50 }).notNull(),
    HttpMethod: varchar('HttpMethod', { length: 10 }),
    Url: varchar('Url', { length: 500 }),
    HttpStatus: smallint('HttpStatus'),
    LatencyMs: integer('LatencyMs'),
    CorrelationId: varchar('CorrelationId', { length: 64 }),
    Outcome: smallint('Outcome').notNull(),
    ErrorMessage: varchar('ErrorMessage', { length: 1000 }),
    RequestExcerpt: text('RequestExcerpt'),
    ResponseExcerpt: text('ResponseExcerpt'),
    OccurredAt: tstz('OccurredAt').notNull().defaultNow(),
  },
  (t) => [
    index('IX_CallLogs_Source_Time').on(t.Source, t.OccurredAt.desc()),
    index('IX_CallLogs_Outcome_Time').on(t.Outcome, t.OccurredAt.desc()),
  ],
);

/**
 * Local projection of the jobs Booking POSTs (DL46). Status 1 Planned · 2 Confirmed · 3 InProgress ·
 * 4 Completed · 5 Cancelled · 9 Unknown. MappingIssues 2 UnknownLeaderRef · 3 UnmappedStatus ·
 * 4 MissingWindow · 5 UnknownDeviceRef (1, 6 reserved — never reuse).
 */
export const BookingJobs = pgTable(
  'BookingJobs',
  {
    Id: pkId(),
    SourceSystem: varchar('SourceSystem', { length: 30 }).notNull().default('BOOKING'),
    ExternalJobId: varchar('ExternalJobId', { length: 100 }).notNull(),
    ExternalJobNo: varchar('ExternalJobNo', { length: 50 }),
    DoNo: varchar('DoNo', { length: 50 }),
    ShNo: varchar('ShNo', { length: 50 }),
    ExternalVersion: varchar('ExternalVersion', { length: 100 }),
    ExternalUpdatedAt: tstz('ExternalUpdatedAt'),
    Status: smallint('Status').notNull(),
    RawStatus: varchar('RawStatus', { length: 50 }),
    Title: varchar('Title', { length: 300 }),
    BookingTeamRef: varchar('BookingTeamRef', { length: 64 }),
    TeamId: ref('TeamId', () => Teams.Id),
    BookingLeaderRef: varchar('BookingLeaderRef', { length: 64 }),
    LeaderUserId: userRef('LeaderUserId'),
    ScheduledDate: date('ScheduledDate', { mode: 'string' }),
    PlannedStartAt: tstz('PlannedStartAt'),
    PlannedEndAt: tstz('PlannedEndAt'),
    BookingCheckInAt: tstz('BookingCheckInAt'),
    BookingCheckOutAt: tstz('BookingCheckOutAt'),
    DeviceRefs: varchar('DeviceRefs', { length: 64 }).array(),
    SiteName: varchar('SiteName', { length: 300 }),
    SiteAddress: varchar('SiteAddress', { length: 1000 }),
    SiteLat: doublePrecision('SiteLat'),
    SiteLng: doublePrecision('SiteLng'),
    Raw: jsonb('Raw').notNull(),
    PayloadHash: char('PayloadHash', { length: 64 }).notNull(),
    MappingIssues: smallint('MappingIssues').array(),
    FirstSyncedAt: tstz('FirstSyncedAt').notNull().defaultNow(),
    LastSyncedAt: tstz('LastSyncedAt').notNull().defaultNow(),
    SourceMissingSince: tstz('SourceMissingSince'),
  },
  (t) => [
    uniqueIndex('UQ_BookingJobs_External').on(t.SourceSystem, t.ExternalJobId),
    index('IX_BookingJobs_DeviceRefs').using('gin', t.DeviceRefs),
    index('IX_BookingJobs_TeamRef_Start').on(t.BookingTeamRef, t.PlannedStartAt),
    index('IX_BookingJobs_LeaderRef_Start').on(t.BookingLeaderRef, t.PlannedStartAt),
    index('IX_BookingJobs_Team_Start').on(t.TeamId, t.PlannedStartAt),
    index('IX_BookingJobs_Status_Start').on(t.Status, t.PlannedStartAt),
    index('IX_BookingJobs_ScheduledDate').on(t.ScheduledDate),
    index('IX_BookingJobs_LastSyncedAt').on(t.LastSyncedAt),
    index('IX_BookingJobs_DoNo').on(t.DoNo).where(sql`${t.DoNo} is not null`),
    index('IX_BookingJobs_ShNo').on(t.ShNo).where(sql`${t.ShNo} is not null`),
    check(
      'CK_BookingJobs_Window',
      sql`${t.PlannedEndAt} is null or ${t.PlannedStartAt} is null or ${t.PlannedEndAt} >= ${t.PlannedStartAt}`,
    ),
  ],
);

/**
 * 1:1 with BookingJobs, written only by the inbox processor (DL33). Status 1 Open · 2 Closed ·
 * 3 Cancelled · 6 Planned (4, 5 reserved). CloseReason 1 BookingCheckout · 3 SafetyTimeout (2 reserved).
 * ReviewReasons: 1 BookingChangedAfterClose · 2 CancelledWithEvidence · 3 NoCheckout · 4 AutoSwitched ·
 * 5 SourceMissing · 6 SafetyTimeout (7 reserved).
 */
export const WorkOrders = pgTable(
  'WorkOrders',
  {
    Id: pkId(),
    WorkOrderNo: varchar('WorkOrderNo', { length: 30 }).notNull(),
    Title: varchar('Title', { length: 300 }).notNull(),
    Status: smallint('Status').notNull().default(6),
    CloseReason: smallint('CloseReason'),
    BookingJobId: ref('BookingJobId', () => BookingJobs.Id).notNull(),
    TeamId: ref('TeamId', () => Teams.Id),
    LeaderUserId: userRef('LeaderUserId'),
    OpenedAt: tstz('OpenedAt'),
    LastActivityAt: tstz('LastActivityAt'),
    ClosedAt: tstz('ClosedAt'),
    NeedsReview: boolean('NeedsReview').notNull().default(false),
    ReviewReasons: smallint('ReviewReasons').array(),
    Note: varchar('Note', { length: 2000 }),
    RowVersion: integer('RowVersion').notNull().default(1),
    CreatedAt: createdAt(),
    UpdatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('UQ_WO_No').on(t.WorkOrderNo),
    unique('UQ_WO_BookingJob').on(t.BookingJobId),
    index('IX_WO_Status_Opened').on(t.Status, t.OpenedAt.desc()),
    index('IX_WO_Team_Opened').on(t.TeamId, t.OpenedAt.desc()),
    // Closed (2) and Cancelled (3) always carry ClosedAt; Planned / Open never do.
    check('CK_WO_Closed', sql`(${t.Status} in (2, 3)) = (${t.ClosedAt} is not null)`),
  ],
);

/** EventType 1 Created · 2 StatusChanged · 6 SessionAttached · 7 SessionDetached · 9 NoteUpdated · 10 ReviewFlagged. Source 1 System · 2 Booking · 3 Operator · 4 Admin. */
export const WorkOrderEvents = pgTable(
  'WorkOrderEvents',
  {
    Id: pkId(),
    WorkOrderId: ref('WorkOrderId', () => WorkOrders.Id).notNull(),
    EventType: smallint('EventType').notNull(),
    FromStatus: smallint('FromStatus'),
    ToStatus: smallint('ToStatus'),
    Source: smallint('Source').notNull(),
    ActorUserId: userRef('ActorUserId'),
    // FK to TrackingSessions arrives with that table (P3b)
    TrackingSessionId: fk('TrackingSessionId'),
    BookingJobId: ref('BookingJobId', () => BookingJobs.Id),
    Reason: varchar('Reason', { length: 500 }),
    Detail: jsonb('Detail'),
    OccurredAt: tstz('OccurredAt').notNull().defaultNow(),
  },
  (t) => [index('IX_WOEvents_WO_Time').on(t.WorkOrderId, t.OccurredAt)],
);

/** Atomic work-order number counter per Asia/Bangkok month (`YYYYMM`). */
export const WorkOrderCounters = pgTable('WorkOrderCounters', {
  Period: char('Period', { length: 6 }).primaryKey(),
  LastValue: integer('LastValue').notNull(),
});

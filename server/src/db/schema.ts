import {
  type AnyPgColumn,
  boolean,
  char,
  index,
  pgTable,
  primaryKey,
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
  notDeleted,
  pkId,
  ref,
  softDelete,
  tstz,
  updatedAt,
  userRef,
} from './columns';

// Canonical names: docs/blueprint/04-database-design.md section 4.4 A.
// AuditLogs is partitioned and lives in schema.partitioned.ts (outside drizzle-kit's schema path).

export const Departments = pgTable(
  'Departments',
  {
    Id: pkId(),
    Code: varchar('Code', { length: 30 }).notNull(),
    Name: varchar('Name', { length: 200 }).notNull(),
    ParentId: ref('ParentId', (): AnyPgColumn => Departments.Id),
    IsActive: boolean('IsActive').notNull().default(true),
    CreatedAt: createdAt(),
    UpdatedAt: updatedAt(),
    ...auditActor(),
    ...softDelete(),
  },
  (t) => [
    index('IX_Departments_Parent').on(t.ParentId),
    uniqueIndex('UQ_Departments_Code').on(t.Code).where(notDeleted(t)),
  ],
);

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
    // null only for roles whose scope is `all`
    DepartmentId: ref('DepartmentId', () => Departments.Id),
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
    index('IX_Users_Department').on(t.DepartmentId),
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
    DepartmentId: ref('DepartmentId', () => Departments.Id).notNull(),
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
    index('IX_Employees_Department').on(t.DepartmentId),
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

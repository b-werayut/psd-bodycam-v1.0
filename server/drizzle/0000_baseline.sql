CREATE TABLE "Departments" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "Departments_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"Code" varchar(30) NOT NULL,
	"Name" varchar(200) NOT NULL,
	"ParentId" bigint,
	"IsActive" boolean DEFAULT true NOT NULL,
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"UpdatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"CreatedBy" bigint,
	"UpdatedBy" bigint,
	"IsDeleted" boolean DEFAULT false NOT NULL,
	"DeletedAt" timestamp with time zone,
	"DeletedBy" bigint
);
--> statement-breakpoint
CREATE TABLE "Employees" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "Employees_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"EmployeeCode" varchar(30) NOT NULL,
	"FirstName" varchar(100) NOT NULL,
	"LastName" varchar(100) NOT NULL,
	"Phone" varchar(30),
	"DepartmentId" bigint NOT NULL,
	"UserId" bigint,
	"BookingEmployeeRef" varchar(64),
	"Status" smallint DEFAULT 1 NOT NULL,
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"UpdatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"CreatedBy" bigint,
	"UpdatedBy" bigint,
	"IsDeleted" boolean DEFAULT false NOT NULL,
	"DeletedAt" timestamp with time zone,
	"DeletedBy" bigint
);
--> statement-breakpoint
CREATE TABLE "Permissions" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "Permissions_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"Code" varchar(100) NOT NULL,
	"Resource" varchar(50) NOT NULL,
	"Action" varchar(30) NOT NULL,
	"Description" varchar(300),
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "UQ_Permissions_Code" UNIQUE("Code")
);
--> statement-breakpoint
CREATE TABLE "PushTokens" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "PushTokens_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"UserId" bigint NOT NULL,
	"UserDeviceId" bigint,
	"Token" varchar(512) NOT NULL,
	"Platform" smallint,
	"IsRevoked" boolean DEFAULT false NOT NULL,
	"FailureCount" smallint DEFAULT 0 NOT NULL,
	"LastUsedAt" timestamp with time zone,
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "UQ_PushTokens_Token" UNIQUE("Token")
);
--> statement-breakpoint
CREATE TABLE "RefreshTokens" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "RefreshTokens_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"UserId" bigint NOT NULL,
	"TokenHash" char(64) NOT NULL,
	"ExpiresAt" timestamp with time zone NOT NULL,
	"RevokedAt" timestamp with time zone,
	"ReplacedByTokenId" bigint,
	"UserDeviceId" bigint,
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "UQ_RefreshTokens_TokenHash" UNIQUE("TokenHash")
);
--> statement-breakpoint
CREATE TABLE "RolePermissions" (
	"RoleId" bigint NOT NULL,
	"PermissionId" bigint NOT NULL,
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "PK_RolePermissions" PRIMARY KEY("RoleId","PermissionId")
);
--> statement-breakpoint
CREATE TABLE "Roles" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "Roles_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"Code" varchar(30) NOT NULL,
	"Name" varchar(100) NOT NULL,
	"Description" varchar(300),
	"IsSystem" boolean DEFAULT true NOT NULL,
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"UpdatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "UQ_Roles_Code" UNIQUE("Code")
);
--> statement-breakpoint
CREATE TABLE "Settings" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "Settings_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"SettingKey" varchar(100) NOT NULL,
	"SettingValue" text,
	"ValueType" smallint NOT NULL,
	"Category" varchar(50),
	"Description" varchar(500),
	"IsSystem" boolean DEFAULT false NOT NULL,
	"UpdatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"UpdatedBy" bigint,
	CONSTRAINT "UQ_Settings_Key" UNIQUE("SettingKey")
);
--> statement-breakpoint
CREATE TABLE "UserDevices" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "UserDevices_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"UserId" bigint NOT NULL,
	"InstallationId" varchar(100) NOT NULL,
	"Platform" smallint NOT NULL,
	"DeviceName" varchar(100),
	"PushEnabled" boolean DEFAULT true NOT NULL,
	"IsRevoked" boolean DEFAULT false NOT NULL,
	"LastSeenAt" timestamp with time zone,
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Users" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "Users_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"Username" varchar(50) NOT NULL,
	"PasswordHash" varchar(255),
	"Email" varchar(200),
	"FullName" varchar(200) NOT NULL,
	"AzureObjectId" varchar(64),
	"RoleId" bigint NOT NULL,
	"DepartmentId" bigint,
	"Status" smallint DEFAULT 1 NOT NULL,
	"FailedLoginCount" smallint DEFAULT 0 NOT NULL,
	"LockedUntil" timestamp with time zone,
	"LastLoginAt" timestamp with time zone,
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"UpdatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"CreatedBy" bigint,
	"UpdatedBy" bigint,
	"IsDeleted" boolean DEFAULT false NOT NULL,
	"DeletedAt" timestamp with time zone,
	"DeletedBy" bigint
);
--> statement-breakpoint
ALTER TABLE "Departments" ADD CONSTRAINT "Departments_ParentId_Departments_Id_fk" FOREIGN KEY ("ParentId") REFERENCES "public"."Departments"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Departments" ADD CONSTRAINT "Departments_CreatedBy_Users_Id_fk" FOREIGN KEY ("CreatedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Departments" ADD CONSTRAINT "Departments_UpdatedBy_Users_Id_fk" FOREIGN KEY ("UpdatedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Departments" ADD CONSTRAINT "Departments_DeletedBy_Users_Id_fk" FOREIGN KEY ("DeletedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Employees" ADD CONSTRAINT "Employees_DepartmentId_Departments_Id_fk" FOREIGN KEY ("DepartmentId") REFERENCES "public"."Departments"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Employees" ADD CONSTRAINT "Employees_UserId_Users_Id_fk" FOREIGN KEY ("UserId") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Employees" ADD CONSTRAINT "Employees_CreatedBy_Users_Id_fk" FOREIGN KEY ("CreatedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Employees" ADD CONSTRAINT "Employees_UpdatedBy_Users_Id_fk" FOREIGN KEY ("UpdatedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Employees" ADD CONSTRAINT "Employees_DeletedBy_Users_Id_fk" FOREIGN KEY ("DeletedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PushTokens" ADD CONSTRAINT "PushTokens_UserId_Users_Id_fk" FOREIGN KEY ("UserId") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PushTokens" ADD CONSTRAINT "PushTokens_UserDeviceId_UserDevices_Id_fk" FOREIGN KEY ("UserDeviceId") REFERENCES "public"."UserDevices"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RefreshTokens" ADD CONSTRAINT "RefreshTokens_UserId_Users_Id_fk" FOREIGN KEY ("UserId") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RefreshTokens" ADD CONSTRAINT "RefreshTokens_ReplacedByTokenId_RefreshTokens_Id_fk" FOREIGN KEY ("ReplacedByTokenId") REFERENCES "public"."RefreshTokens"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RefreshTokens" ADD CONSTRAINT "RefreshTokens_UserDeviceId_UserDevices_Id_fk" FOREIGN KEY ("UserDeviceId") REFERENCES "public"."UserDevices"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RolePermissions" ADD CONSTRAINT "RolePermissions_RoleId_Roles_Id_fk" FOREIGN KEY ("RoleId") REFERENCES "public"."Roles"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "RolePermissions" ADD CONSTRAINT "RolePermissions_PermissionId_Permissions_Id_fk" FOREIGN KEY ("PermissionId") REFERENCES "public"."Permissions"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_UpdatedBy_Users_Id_fk" FOREIGN KEY ("UpdatedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "UserDevices" ADD CONSTRAINT "UserDevices_UserId_Users_Id_fk" FOREIGN KEY ("UserId") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Users" ADD CONSTRAINT "Users_RoleId_Roles_Id_fk" FOREIGN KEY ("RoleId") REFERENCES "public"."Roles"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Users" ADD CONSTRAINT "Users_DepartmentId_Departments_Id_fk" FOREIGN KEY ("DepartmentId") REFERENCES "public"."Departments"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Users" ADD CONSTRAINT "Users_CreatedBy_Users_Id_fk" FOREIGN KEY ("CreatedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Users" ADD CONSTRAINT "Users_UpdatedBy_Users_Id_fk" FOREIGN KEY ("UpdatedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Users" ADD CONSTRAINT "Users_DeletedBy_Users_Id_fk" FOREIGN KEY ("DeletedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IX_Departments_Parent" ON "Departments" USING btree ("ParentId");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_Departments_Code" ON "Departments" USING btree ("Code") WHERE "Departments"."IsDeleted" = false;--> statement-breakpoint
CREATE INDEX "IX_Employees_Department" ON "Employees" USING btree ("DepartmentId");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_Employees_Code" ON "Employees" USING btree ("EmployeeCode") WHERE "Employees"."IsDeleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_Employees_User" ON "Employees" USING btree ("UserId") WHERE "Employees"."UserId" is not null and "Employees"."IsDeleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_Employees_BookingRef" ON "Employees" USING btree ("BookingEmployeeRef") WHERE "Employees"."BookingEmployeeRef" is not null and "Employees"."IsDeleted" = false;--> statement-breakpoint
CREATE INDEX "IX_Permissions_Resource" ON "Permissions" USING btree ("Resource");--> statement-breakpoint
CREATE INDEX "IX_PushTokens_User" ON "PushTokens" USING btree ("UserId","IsRevoked");--> statement-breakpoint
CREATE INDEX "IX_PushTokens_UserDevice" ON "PushTokens" USING btree ("UserDeviceId");--> statement-breakpoint
CREATE INDEX "IX_RefreshTokens_User" ON "RefreshTokens" USING btree ("UserId","ExpiresAt");--> statement-breakpoint
CREATE INDEX "IX_RefreshTokens_UserDevice" ON "RefreshTokens" USING btree ("UserDeviceId");--> statement-breakpoint
CREATE INDEX "IX_RolePermissions_Permission" ON "RolePermissions" USING btree ("PermissionId");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_UserDevices_User_Installation" ON "UserDevices" USING btree ("UserId","InstallationId");--> statement-breakpoint
CREATE INDEX "IX_UserDevices_User" ON "UserDevices" USING btree ("UserId","IsRevoked");--> statement-breakpoint
CREATE INDEX "IX_Users_Department" ON "Users" USING btree ("DepartmentId");--> statement-breakpoint
CREATE INDEX "IX_Users_Role" ON "Users" USING btree ("RoleId");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_Users_Username" ON "Users" USING btree (lower("Username")) WHERE "Users"."IsDeleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_Users_Email" ON "Users" USING btree (lower("Email")) WHERE "Users"."IsDeleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_Users_AzureObjectId" ON "Users" USING btree ("AzureObjectId") WHERE "Users"."IsDeleted" = false;
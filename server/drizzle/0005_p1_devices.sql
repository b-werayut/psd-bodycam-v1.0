CREATE TABLE "Alerts" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "Alerts_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"AlertType" smallint NOT NULL,
	"Severity" smallint NOT NULL,
	"Status" smallint DEFAULT 1 NOT NULL,
	"DeviceId" bigint,
	"TeamId" bigint,
	"WorkOrderId" bigint,
	"TrackingSessionId" bigint,
	"BookingJobId" bigint,
	"Title" varchar(200),
	"Message" text,
	"Data" jsonb,
	"DedupeKey" varchar(150),
	"OccurredAt" timestamp with time zone DEFAULT now() NOT NULL,
	"AcknowledgedAt" timestamp with time zone,
	"AcknowledgedBy" bigint,
	"ResolvedAt" timestamp with time zone,
	"ResolvedBy" bigint
);
--> statement-breakpoint
CREATE TABLE "Depots" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "Depots_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"Code" varchar(30) NOT NULL,
	"Name" varchar(200) NOT NULL,
	"Lat" double precision NOT NULL,
	"Lng" double precision NOT NULL,
	"RadiusM" integer DEFAULT 150 NOT NULL,
	"IsActive" boolean DEFAULT true NOT NULL,
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"UpdatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"CreatedBy" bigint,
	"UpdatedBy" bigint,
	"IsDeleted" boolean DEFAULT false NOT NULL,
	"DeletedAt" timestamp with time zone,
	"DeletedBy" bigint,
	CONSTRAINT "CK_Depots_Radius" CHECK ("Depots"."RadiusM" between 20 and 2000)
);
--> statement-breakpoint
CREATE TABLE "DeviceState" (
	"DeviceId" bigint PRIMARY KEY NOT NULL,
	"PlatformState" smallint,
	"StateSince" timestamp with time zone,
	"LastObservedAt" timestamp with time zone,
	"LastOnlineObservedAt" timestamp with time zone,
	"LastSource" smallint,
	"StateSource" smallint,
	"StateSourceObservedAt" timestamp with time zone,
	"LastFixAt" timestamp with time zone,
	"LastLat" double precision,
	"LastLng" double precision,
	"LastSpeedKph" real,
	"LastHeading" smallint,
	"LastFixValid" boolean,
	"LastBatteryPercent" smallint,
	"IsAtDepot" boolean,
	"UpdatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "DeviceStatusHistory" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "DeviceStatusHistory_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"DeviceId" bigint NOT NULL,
	"FromState" smallint,
	"ToState" smallint NOT NULL,
	"ObservedAt" timestamp with time zone NOT NULL,
	"Source" smallint NOT NULL,
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Devices" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "Devices_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"DeviceCode" varchar(30) NOT NULL,
	"VendorDeviceId" varchar(64) NOT NULL,
	"Name" varchar(200),
	"Model" varchar(100),
	"SerialNo" varchar(100),
	"Firmware" varchar(100),
	"SimNumber" varchar(30),
	"Kind" smallint NOT NULL,
	"Status" smallint DEFAULT 1 NOT NULL,
	"StreamingEnabled" boolean DEFAULT true NOT NULL,
	"VendorSeenAt" timestamp with time zone,
	"VendorMissingSince" timestamp with time zone,
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"UpdatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"CreatedBy" bigint,
	"UpdatedBy" bigint,
	"IsDeleted" boolean DEFAULT false NOT NULL,
	"DeletedAt" timestamp with time zone,
	"DeletedBy" bigint
);
--> statement-breakpoint
CREATE TABLE "TeamMembers" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "TeamMembers_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"TeamId" bigint NOT NULL,
	"EmployeeId" bigint NOT NULL,
	"Role" smallint NOT NULL,
	"ValidFrom" timestamp with time zone NOT NULL,
	"ValidTo" timestamp with time zone,
	"AssignedBy" bigint,
	"Note" varchar(500),
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "CK_TeamMembers_Window" CHECK ("TeamMembers"."ValidTo" is null or "TeamMembers"."ValidTo" > "TeamMembers"."ValidFrom")
);
--> statement-breakpoint
CREATE TABLE "Teams" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "Teams_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"Code" varchar(30) NOT NULL,
	"Name" varchar(200) NOT NULL,
	"BookingTeamRef" varchar(64),
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
ALTER TABLE "Alerts" ADD CONSTRAINT "Alerts_DeviceId_Devices_Id_fk" FOREIGN KEY ("DeviceId") REFERENCES "public"."Devices"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Alerts" ADD CONSTRAINT "Alerts_TeamId_Teams_Id_fk" FOREIGN KEY ("TeamId") REFERENCES "public"."Teams"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Alerts" ADD CONSTRAINT "Alerts_AcknowledgedBy_Users_Id_fk" FOREIGN KEY ("AcknowledgedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Alerts" ADD CONSTRAINT "Alerts_ResolvedBy_Users_Id_fk" FOREIGN KEY ("ResolvedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Depots" ADD CONSTRAINT "Depots_CreatedBy_Users_Id_fk" FOREIGN KEY ("CreatedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Depots" ADD CONSTRAINT "Depots_UpdatedBy_Users_Id_fk" FOREIGN KEY ("UpdatedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Depots" ADD CONSTRAINT "Depots_DeletedBy_Users_Id_fk" FOREIGN KEY ("DeletedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "DeviceState" ADD CONSTRAINT "DeviceState_DeviceId_Devices_Id_fk" FOREIGN KEY ("DeviceId") REFERENCES "public"."Devices"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "DeviceStatusHistory" ADD CONSTRAINT "DeviceStatusHistory_DeviceId_Devices_Id_fk" FOREIGN KEY ("DeviceId") REFERENCES "public"."Devices"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Devices" ADD CONSTRAINT "Devices_CreatedBy_Users_Id_fk" FOREIGN KEY ("CreatedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Devices" ADD CONSTRAINT "Devices_UpdatedBy_Users_Id_fk" FOREIGN KEY ("UpdatedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Devices" ADD CONSTRAINT "Devices_DeletedBy_Users_Id_fk" FOREIGN KEY ("DeletedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TeamMembers" ADD CONSTRAINT "TeamMembers_TeamId_Teams_Id_fk" FOREIGN KEY ("TeamId") REFERENCES "public"."Teams"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TeamMembers" ADD CONSTRAINT "TeamMembers_EmployeeId_Employees_Id_fk" FOREIGN KEY ("EmployeeId") REFERENCES "public"."Employees"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TeamMembers" ADD CONSTRAINT "TeamMembers_AssignedBy_Users_Id_fk" FOREIGN KEY ("AssignedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Teams" ADD CONSTRAINT "Teams_CreatedBy_Users_Id_fk" FOREIGN KEY ("CreatedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Teams" ADD CONSTRAINT "Teams_UpdatedBy_Users_Id_fk" FOREIGN KEY ("UpdatedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Teams" ADD CONSTRAINT "Teams_DeletedBy_Users_Id_fk" FOREIGN KEY ("DeletedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_Alerts_OpenDedupe" ON "Alerts" USING btree ("DedupeKey") WHERE "Alerts"."Status" in (1, 2);--> statement-breakpoint
CREATE INDEX "IX_Alerts_Status" ON "Alerts" USING btree ("Status","Severity","OccurredAt" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_Depots_Code" ON "Depots" USING btree ("Code") WHERE "Depots"."IsDeleted" = false;--> statement-breakpoint
CREATE INDEX "IX_DeviceState_PlatformState" ON "DeviceState" USING btree ("PlatformState");--> statement-breakpoint
CREATE INDEX "IX_DeviceStatusHistory_Device" ON "DeviceStatusHistory" USING btree ("DeviceId","ObservedAt" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_Devices_Code" ON "Devices" USING btree ("DeviceCode") WHERE "Devices"."IsDeleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_Devices_VendorId" ON "Devices" USING btree ("VendorDeviceId");--> statement-breakpoint
CREATE INDEX "IX_Devices_Status" ON "Devices" USING btree ("Status");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_TeamMembers_ActiveLeader" ON "TeamMembers" USING btree ("TeamId") WHERE "TeamMembers"."Role" = 1 and "TeamMembers"."ValidTo" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_TeamMembers_ActiveEmployee" ON "TeamMembers" USING btree ("EmployeeId") WHERE "TeamMembers"."ValidTo" is null;--> statement-breakpoint
CREATE INDEX "IX_TeamMembers_Team" ON "TeamMembers" USING btree ("TeamId","ValidFrom" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_Teams_Code" ON "Teams" USING btree ("Code") WHERE "Teams"."IsDeleted" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_Teams_BookingRef" ON "Teams" USING btree ("BookingTeamRef") WHERE "Teams"."BookingTeamRef" is not null and "Teams"."IsDeleted" = false;
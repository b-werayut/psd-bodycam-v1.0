CREATE TABLE "BookingJobs" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "BookingJobs_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"SourceSystem" varchar(30) DEFAULT 'BOOKING' NOT NULL,
	"ExternalJobId" varchar(100) NOT NULL,
	"ExternalJobNo" varchar(50),
	"DoNo" varchar(50),
	"ShNo" varchar(50),
	"ExternalVersion" varchar(100),
	"ExternalUpdatedAt" timestamp with time zone,
	"Status" smallint NOT NULL,
	"RawStatus" varchar(50),
	"Title" varchar(300),
	"BookingTeamRef" varchar(64),
	"TeamId" bigint,
	"BookingLeaderRef" varchar(64),
	"LeaderUserId" bigint,
	"ScheduledDate" date,
	"PlannedStartAt" timestamp with time zone,
	"PlannedEndAt" timestamp with time zone,
	"BookingCheckInAt" timestamp with time zone,
	"BookingCheckOutAt" timestamp with time zone,
	"DeviceRefs" varchar(64)[],
	"SiteName" varchar(300),
	"SiteAddress" varchar(1000),
	"SiteLat" double precision,
	"SiteLng" double precision,
	"Raw" jsonb NOT NULL,
	"PayloadHash" char(64) NOT NULL,
	"MappingIssues" smallint[],
	"FirstSyncedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"LastSyncedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"SourceMissingSince" timestamp with time zone,
	CONSTRAINT "CK_BookingJobs_Window" CHECK ("BookingJobs"."PlannedEndAt" is null or "BookingJobs"."PlannedStartAt" is null or "BookingJobs"."PlannedEndAt" >= "BookingJobs"."PlannedStartAt")
);
--> statement-breakpoint
CREATE TABLE "IntegrationCallLogs" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "IntegrationCallLogs_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"Source" varchar(30) NOT NULL,
	"Direction" smallint NOT NULL,
	"Operation" varchar(50) NOT NULL,
	"HttpMethod" varchar(10),
	"Url" varchar(500),
	"HttpStatus" smallint,
	"LatencyMs" integer,
	"CorrelationId" varchar(64),
	"Outcome" smallint NOT NULL,
	"ErrorMessage" varchar(1000),
	"RequestExcerpt" text,
	"ResponseExcerpt" text,
	"OccurredAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "IntegrationInbox" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "IntegrationInbox_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"Source" varchar(30) NOT NULL,
	"ExternalEventId" varchar(200) NOT NULL,
	"EventType" varchar(50),
	"Channel" smallint DEFAULT 1 NOT NULL,
	"Payload" jsonb NOT NULL,
	"ReceivedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"Status" smallint NOT NULL,
	"Attempts" smallint DEFAULT 0 NOT NULL,
	"LastError" text,
	"ProcessedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "IntegrationSyncState" (
	"Source" varchar(30) NOT NULL,
	"Resource" varchar(50) NOT NULL,
	"LastReceivedAt" timestamp with time zone,
	"LastAttemptAt" timestamp with time zone,
	"LastSuccessAt" timestamp with time zone,
	"LastFullSyncAt" timestamp with time zone,
	"LastErrorAt" timestamp with time zone,
	"LastError" text,
	"ConsecutiveFailures" integer DEFAULT 0 NOT NULL,
	"BreakerOpenUntil" timestamp with time zone,
	CONSTRAINT "PK_IntegrationSyncState" PRIMARY KEY("Source","Resource")
);
--> statement-breakpoint
CREATE TABLE "WorkOrderCounters" (
	"Period" char(6) PRIMARY KEY NOT NULL,
	"LastValue" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WorkOrderEvents" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "WorkOrderEvents_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"WorkOrderId" bigint NOT NULL,
	"EventType" smallint NOT NULL,
	"FromStatus" smallint,
	"ToStatus" smallint,
	"Source" smallint NOT NULL,
	"ActorUserId" bigint,
	"TrackingSessionId" bigint,
	"BookingJobId" bigint,
	"Reason" varchar(500),
	"Detail" jsonb,
	"OccurredAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "WorkOrders" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "WorkOrders_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"WorkOrderNo" varchar(30) NOT NULL,
	"Title" varchar(300) NOT NULL,
	"Status" smallint DEFAULT 6 NOT NULL,
	"CloseReason" smallint,
	"BookingJobId" bigint NOT NULL,
	"TeamId" bigint,
	"LeaderUserId" bigint,
	"OpenedAt" timestamp with time zone,
	"LastActivityAt" timestamp with time zone,
	"ClosedAt" timestamp with time zone,
	"NeedsReview" boolean DEFAULT false NOT NULL,
	"ReviewReasons" smallint[],
	"Note" varchar(2000),
	"RowVersion" integer DEFAULT 1 NOT NULL,
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"UpdatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "UQ_WO_BookingJob" UNIQUE("BookingJobId"),
	CONSTRAINT "CK_WO_Closed" CHECK (("WorkOrders"."Status" in (2, 3)) = ("WorkOrders"."ClosedAt" is not null))
);
--> statement-breakpoint
ALTER TABLE "Teams" ALTER COLUMN "Code" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "BookingJobs" ADD CONSTRAINT "BookingJobs_TeamId_Teams_Id_fk" FOREIGN KEY ("TeamId") REFERENCES "public"."Teams"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "BookingJobs" ADD CONSTRAINT "BookingJobs_LeaderUserId_Users_Id_fk" FOREIGN KEY ("LeaderUserId") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WorkOrderEvents" ADD CONSTRAINT "WorkOrderEvents_WorkOrderId_WorkOrders_Id_fk" FOREIGN KEY ("WorkOrderId") REFERENCES "public"."WorkOrders"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WorkOrderEvents" ADD CONSTRAINT "WorkOrderEvents_ActorUserId_Users_Id_fk" FOREIGN KEY ("ActorUserId") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WorkOrderEvents" ADD CONSTRAINT "WorkOrderEvents_BookingJobId_BookingJobs_Id_fk" FOREIGN KEY ("BookingJobId") REFERENCES "public"."BookingJobs"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WorkOrders" ADD CONSTRAINT "WorkOrders_BookingJobId_BookingJobs_Id_fk" FOREIGN KEY ("BookingJobId") REFERENCES "public"."BookingJobs"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WorkOrders" ADD CONSTRAINT "WorkOrders_TeamId_Teams_Id_fk" FOREIGN KEY ("TeamId") REFERENCES "public"."Teams"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "WorkOrders" ADD CONSTRAINT "WorkOrders_LeaderUserId_Users_Id_fk" FOREIGN KEY ("LeaderUserId") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_BookingJobs_External" ON "BookingJobs" USING btree ("SourceSystem","ExternalJobId");--> statement-breakpoint
CREATE INDEX "IX_BookingJobs_DeviceRefs" ON "BookingJobs" USING gin ("DeviceRefs");--> statement-breakpoint
CREATE INDEX "IX_BookingJobs_TeamRef_Start" ON "BookingJobs" USING btree ("BookingTeamRef","PlannedStartAt");--> statement-breakpoint
CREATE INDEX "IX_BookingJobs_LeaderRef_Start" ON "BookingJobs" USING btree ("BookingLeaderRef","PlannedStartAt");--> statement-breakpoint
CREATE INDEX "IX_BookingJobs_Team_Start" ON "BookingJobs" USING btree ("TeamId","PlannedStartAt");--> statement-breakpoint
CREATE INDEX "IX_BookingJobs_Status_Start" ON "BookingJobs" USING btree ("Status","PlannedStartAt");--> statement-breakpoint
CREATE INDEX "IX_BookingJobs_ScheduledDate" ON "BookingJobs" USING btree ("ScheduledDate");--> statement-breakpoint
CREATE INDEX "IX_BookingJobs_LastSyncedAt" ON "BookingJobs" USING btree ("LastSyncedAt");--> statement-breakpoint
CREATE INDEX "IX_BookingJobs_DoNo" ON "BookingJobs" USING btree ("DoNo") WHERE "BookingJobs"."DoNo" is not null;--> statement-breakpoint
CREATE INDEX "IX_BookingJobs_ShNo" ON "BookingJobs" USING btree ("ShNo") WHERE "BookingJobs"."ShNo" is not null;--> statement-breakpoint
CREATE INDEX "IX_CallLogs_Source_Time" ON "IntegrationCallLogs" USING btree ("Source","OccurredAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "IX_CallLogs_Outcome_Time" ON "IntegrationCallLogs" USING btree ("Outcome","OccurredAt" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_Inbox_Event" ON "IntegrationInbox" USING btree ("Source","ExternalEventId");--> statement-breakpoint
CREATE INDEX "IX_Inbox_Pending" ON "IntegrationInbox" USING btree ("Status","ReceivedAt") WHERE "IntegrationInbox"."Status" in (1, 3);--> statement-breakpoint
CREATE INDEX "IX_WOEvents_WO_Time" ON "WorkOrderEvents" USING btree ("WorkOrderId","OccurredAt");--> statement-breakpoint
CREATE UNIQUE INDEX "UQ_WO_No" ON "WorkOrders" USING btree ("WorkOrderNo");--> statement-breakpoint
CREATE INDEX "IX_WO_Status_Opened" ON "WorkOrders" USING btree ("Status","OpenedAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "IX_WO_Team_Opened" ON "WorkOrders" USING btree ("TeamId","OpenedAt" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "Alerts" ADD CONSTRAINT "Alerts_WorkOrderId_WorkOrders_Id_fk" FOREIGN KEY ("WorkOrderId") REFERENCES "public"."WorkOrders"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Alerts" ADD CONSTRAINT "Alerts_BookingJobId_BookingJobs_Id_fk" FOREIGN KEY ("BookingJobId") REFERENCES "public"."BookingJobs"("Id") ON DELETE no action ON UPDATE no action;
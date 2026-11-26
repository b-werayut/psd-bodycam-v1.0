CREATE TABLE "EvidenceExports" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "EvidenceExports_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"DeviceId" bigint NOT NULL,
	"Channel" smallint DEFAULT 1 NOT NULL,
	"WorkOrderId" bigint,
	"StartAt" timestamp with time zone NOT NULL,
	"EndAt" timestamp with time zone NOT NULL,
	"Status" smallint DEFAULT 1 NOT NULL,
	"Progress" smallint DEFAULT 0 NOT NULL,
	"MediaSeconds" integer,
	"FilePath" varchar(500),
	"FileName" varchar(200),
	"FileSizeBytes" bigint,
	"Checksum" varchar(64),
	"ErrorMessage" varchar(500),
	"RequestedBy" bigint NOT NULL,
	"RequestedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"StartedAt" timestamp with time zone,
	"CompletedAt" timestamp with time zone,
	"ExpiresAt" timestamp with time zone,
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"UpdatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "EvidenceExports" ADD CONSTRAINT "EvidenceExports_DeviceId_Devices_Id_fk" FOREIGN KEY ("DeviceId") REFERENCES "public"."Devices"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "EvidenceExports" ADD CONSTRAINT "EvidenceExports_WorkOrderId_WorkOrders_Id_fk" FOREIGN KEY ("WorkOrderId") REFERENCES "public"."WorkOrders"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "EvidenceExports" ADD CONSTRAINT "EvidenceExports_RequestedBy_Users_Id_fk" FOREIGN KEY ("RequestedBy") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IX_EvidenceExport_Range" ON "EvidenceExports" USING btree ("DeviceId","Channel","StartAt","EndAt");--> statement-breakpoint
CREATE INDEX "IX_EvidenceExport_Status" ON "EvidenceExports" USING btree ("Status","ExpiresAt");--> statement-breakpoint
CREATE INDEX "IX_EvidenceExport_User" ON "EvidenceExports" USING btree ("RequestedBy","RequestedAt");
--> statement-breakpoint
INSERT INTO "Settings" ("SettingKey", "SettingValue", "ValueType", "Category", "Description") VALUES
  ('streaming.download-max-minutes', '120', 2, 'streaming', 'ดาวน์โหลด MP4 ได้ครั้งละไม่เกิน (นาที)')
ON CONFLICT ("SettingKey") DO NOTHING;

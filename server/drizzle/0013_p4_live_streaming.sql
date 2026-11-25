CREATE TABLE "StreamingSessions" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "StreamingSessions_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"DeviceId" bigint NOT NULL,
	"Channel" smallint DEFAULT 1 NOT NULL,
	"UserId" bigint NOT NULL,
	"SessionToken" varchar(64) NOT NULL,
	"Protocol" smallint,
	"SessionType" smallint DEFAULT 1 NOT NULL,
	"PlaybackStartAt" timestamp with time zone,
	"PlaybackEndAt" timestamp with time zone,
	"Status" smallint DEFAULT 1 NOT NULL,
	"VendorSessionId" varchar(64),
	"RequestedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"StartedAt" timestamp with time zone,
	"LastAccessAt" timestamp with time zone,
	"EndedAt" timestamp with time zone,
	"DurationSeconds" integer,
	"EndReason" smallint,
	"ErrorMessage" varchar(500),
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "UQ_Stream_Token" UNIQUE("SessionToken")
);
--> statement-breakpoint
ALTER TABLE "StreamingSessions" ADD CONSTRAINT "StreamingSessions_DeviceId_Devices_Id_fk" FOREIGN KEY ("DeviceId") REFERENCES "public"."Devices"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "StreamingSessions" ADD CONSTRAINT "StreamingSessions_UserId_Users_Id_fk" FOREIGN KEY ("UserId") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IX_Stream_User_Status" ON "StreamingSessions" USING btree ("UserId","Status");--> statement-breakpoint
CREATE INDEX "IX_Stream_Device_Started" ON "StreamingSessions" USING btree ("DeviceId","StartedAt");--> statement-breakpoint
CREATE INDEX "IX_Stream_Status" ON "StreamingSessions" USING btree ("Status");
--> statement-breakpoint
INSERT INTO "Settings" ("SettingKey", "SettingValue", "ValueType", "Category", "Description") VALUES
  ('streaming.enabled', 'true', 3, 'streaming', 'เปิดใช้งานภาพสด'),
  ('streaming.max-concurrent-per-user', '16', 2, 'streaming', 'จำนวนจอภาพสดพร้อมกันสูงสุดต่อผู้ใช้'),
  ('streaming.url-ttl-seconds', '180', 2, 'streaming', 'ปิดจอภาพที่ไม่มีการเล่นต่อเนื่อง (วินาที)')
ON CONFLICT ("SettingKey") DO NOTHING;

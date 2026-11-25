CREATE TABLE "TalkSessions" (
	"Id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "TalkSessions_Id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"DeviceId" bigint NOT NULL,
	"UserId" bigint NOT NULL,
	"StreamingSessionId" bigint NOT NULL,
	"VendorTalkId" varchar(64),
	"UplinkSampleRate" integer,
	"FrameMs" smallint,
	"TicketHash" varchar(64),
	"TicketExpiresAt" timestamp with time zone,
	"Status" smallint DEFAULT 1 NOT NULL,
	"EndReason" smallint,
	"RequestedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"StartedAt" timestamp with time zone,
	"LastAccessAt" timestamp with time zone,
	"EndedAt" timestamp with time zone,
	"DurationSeconds" integer,
	"ErrorMessage" varchar(500),
	"CreatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "TalkSessions" ADD CONSTRAINT "TalkSessions_DeviceId_Devices_Id_fk" FOREIGN KEY ("DeviceId") REFERENCES "public"."Devices"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TalkSessions" ADD CONSTRAINT "TalkSessions_UserId_Users_Id_fk" FOREIGN KEY ("UserId") REFERENCES "public"."Users"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TalkSessions" ADD CONSTRAINT "TalkSessions_StreamingSessionId_StreamingSessions_Id_fk" FOREIGN KEY ("StreamingSessionId") REFERENCES "public"."StreamingSessions"("Id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IX_Talk_Device" ON "TalkSessions" USING btree ("DeviceId","RequestedAt");--> statement-breakpoint
CREATE INDEX "IX_Talk_User" ON "TalkSessions" USING btree ("UserId","RequestedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "UX_Talk_Device_Open" ON "TalkSessions" USING btree ("DeviceId") WHERE "TalkSessions"."Status" in (1, 2);--> statement-breakpoint
CREATE UNIQUE INDEX "UX_Talk_User_Open" ON "TalkSessions" USING btree ("UserId") WHERE "TalkSessions"."Status" in (1, 2);--> statement-breakpoint
CREATE UNIQUE INDEX "UX_Talk_Ticket" ON "TalkSessions" USING btree ("TicketHash");
--> statement-breakpoint
INSERT INTO "Settings" ("SettingKey", "SettingValue", "ValueType", "Category", "Description") VALUES
  ('streaming.talk-max-seconds', '600', 2, 'streaming', 'ระยะเวลาคุยผ่านกล้องสูงสุดต่อสาย (วินาที)')
ON CONFLICT ("SettingKey") DO NOTHING;
